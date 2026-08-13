/*
  Cochlear Implant - Per-Pixel Frequency Continuum

  Same concept as cochlear-implant.js, but instead of grouping the strip into
  22 electrode segments, each of the 574 pixels is its own frequency slot,
  log-spaced across the speech range (200-8000 Hz). The whole strip is one
  continuous spectrum - no wall-splitting mode.

  The sensor board only reports 32 frequency bins, so each pixel's magnitude
  is linearly interpolated between its two nearest bins. That's what turns
  32 discrete samples into a smooth 574-pixel continuum instead of 32 blocky
  steps.

  Visual effect:
  - Silence: Dim rainbow gradient always visible (red=low freq -> blue=high freq)
  - Pixel nearest maxFrequency: Flashes white, fades back to rainbow color
  - Other pixels: Brighten in their own rainbow color, proportional to
    interpolated frequencyData at that pixel's frequency
  - Brightness decays smoothly per pixel after a peak, same envelope as
    cochlear-implant.js

  Designed for 574-pixel LED strip with sensor expansion board.
*/

// ============================================================================
// CONFIGURATION
// ============================================================================

var DECAY_TIME = 5000  // Milliseconds for brightness decay
var SATURATION_RECOVERY_TIME = 250  // Ms for white → rainbow color (fast recovery)
var MIN_BRIGHTNESS = 0.25  // Minimum brightness for quiet pixels (always visible)

// Frequency range for speech (cochlear implant typical range)
var SPEECH_MIN_FREQ = 200   // Hz - lowest frequency
var SPEECH_MAX_FREQ = 8000  // Hz - highest frequency

// ============================================================================
// PER-PIXEL STATE ARRAYS (one value per pixel - this is the whole point)
// ============================================================================

var pixelValues = array(pixelCount)       // 0.0-1.0 (displayed brightness)
var pixelSaturations = array(pixelCount)  // 0.0-1.0 (1.0=rainbow color, 0.0=white)
var pixelDecayAge = array(pixelCount)     // Milliseconds since last trigger
var pixelTriggered = array(pixelCount)    // Peak brightness a pixel decays from

// Track which pixel is currently white (only one at a time) so saturation
// recovery only has to touch that one pixel instead of scanning all 574
var currentWhitePixel = -1
var whitePixelAge = 0

// Rainbow rotation offset (0.0-1.0, wraps around)
var hueOffset = 0

for (i = 0; i < pixelCount; i++) {
  pixelValues[i] = MIN_BRIGHTNESS   // Dim but visible
  pixelSaturations[i] = 1.0         // Full rainbow color
  pixelDecayAge[i] = DECAY_TIME * 2 // Fully decayed
  pixelTriggered[i] = MIN_BRIGHTNESS
}

// ============================================================================
// FREQUENCY MAPPING - Logarithmic (like real cochlear implants)
// ============================================================================

// Each pixel gets its own log-spaced target frequency, precomputed once.
// Real cochlear implants use log spacing because human hearing is logarithmic.
var LOG_MIN_FREQ = log2(SPEECH_MIN_FREQ)
var LOG_MAX_FREQ = log2(SPEECH_MAX_FREQ)
var LOG_STEP = (LOG_MAX_FREQ - LOG_MIN_FREQ) / (pixelCount - 1)

var pixelFreq = array(pixelCount)  // Target frequency for each pixel

function initializeFrequencyMap() {
  for (i = 0; i < pixelCount; i++) {
    pixelFreq[i] = pow(2, LOG_MIN_FREQ + i * LOG_STEP)
  }
}
initializeFrequencyMap()

// Invert the log mapping to find which pixel a given frequency belongs to
// (used to locate the maxFrequency pixel for the white-flash accent)
function freqToPixelIndex(freq) {
  freq = clamp(freq, SPEECH_MIN_FREQ, SPEECH_MAX_FREQ)
  var idx = round((log2(freq) - LOG_MIN_FREQ) / LOG_STEP)
  return clamp(idx, 0, pixelCount - 1)
}

// The sensor board reports 32 bins at ~312.5 Hz apart. Each pixel's magnitude
// is linearly interpolated between its two nearest bins (inlined into the
// per-pixel loop in beforeRender - pixelFreq[i] is always within
// [SPEECH_MIN_FREQ, SPEECH_MAX_FREQ], so binHigh never exceeds bin 25).
var BIN_HZ = 312.5

// ============================================================================
// AUDIO PROCESSING - Sensor Board Variables
// ============================================================================

export var light = -1  // Ambient light sensor (-1 = no sensor board)
export var frequencyData  // 32-element array of frequency magnitudes
export var maxFrequencyMagnitude
export var maxFrequency
export var energyAverage  // Average energy across all frequency bins

// Sensitivity control (adjusted by AGC)
var agcSensitivity = 300  // Base sensitivity from AGC, before user multiplier
export var sensitivity = 300  // agcSensitivity * userSensitivityMult, applied every frame

// ============================================================================
// AUTOMATIC GAIN CONTROL (AGC) - PI Controller (aligned with audio-lights.js)
// ============================================================================

var maxSensitivity = 2500
var minSensitivity = 5  // Minimum output to ensure some visible light
var brightness = 0.5  // Target brightness

var pic = makePIController(0.05, 0.35, 30, 0, maxSensitivity)

export var lastVal = 0.25
var calcVal = 0

// UI monitoring
var timer = 0
var waitTime = 1000
export var displayedSensitivity = 0
var undershoot = 0
var overshoot = 0

function makePIController(kp, ki, start, min, max) {
  var pic = array(5)
  pic[0] = kp
  pic[1] = ki
  pic[2] = start
  pic[3] = min
  pic[4] = max
  return pic
}

export var gainProportional = 0
export var gainIntegral = 0

function calcPIController(pic, err) {
  pic[2] = clamp(pic[2] + err, pic[3], pic[4])  // Integral accumulator
  gainProportional = pic[0] * err
  gainIntegral = pic[1] * pic[2]
  return clamp(gainProportional + gainIntegral, minSensitivity, pic[4])
}

// ============================================================================
// USER INTERFACE CONTROLS
// ============================================================================

var userDecayTime = 5.0
export function sliderDecayTime(v) {
  userDecayTime = 2.0 + v * 8.0  // 2-10 seconds
  DECAY_TIME = userDecayTime * 1000
  // SATURATION_RECOVERY_TIME stays fast (250ms) - not synced to decay
}

var userSensitivityMult = 1.0
export function sliderSensitivity(v) {
  userSensitivityMult = 0.1 + v * 1.9
}

var colorRotationSpeed = 0  // Hue change per millisecond (0 = stopped)
export function sliderColorRotation(v) {
  if (v < 0.01) {
    colorRotationSpeed = 0  // Stopped
  } else {
    // Map v from 0.01-1.0 to rotation period from 30s to 5s
    var period = 30 - v * 25  // v=0.01→~30s, v=0.5→17.5s, v=1→5s
    colorRotationSpeed = 1.0 / (period * 1000)  // Full hue cycle per period
  }
}

var simulateAudio = false
export function toggleSimulateAudio(bool) {
  simulateAudio = bool
}

var useEnergyAverage = false
export function toggleUseEnergyAverage(bool) {
  useEnergyAverage = bool  // false = maxFrequencyMagnitude, true = energyAverage
}

export function showNumberAvgBrightness() {
  return calcVal
}

export function showNumberSensitivity() {
  return displayedSensitivity
}

// "Active" = still within the loud/decaying phase of its envelope, not just
// above the idle floor - keeps this independent of MIN_BRIGHTNESS tuning.
export function showNumberAvgSaturation() {
  var count = 0
  var sum = 0
  var activeWindow = DECAY_TIME * 0.3
  for (i = 0; i < pixelCount; i++) {
    if (pixelDecayAge[i] < activeWindow) {
      sum += pixelSaturations[i]
      count++
    }
  }
  return count > 0 ? sum / count : 1.0
}

export function gaugeActivePixels() {
  var count = 0
  var activeWindow = DECAY_TIME * 0.3
  for (i = 0; i < pixelCount; i++) {
    if (pixelDecayAge[i] < activeWindow) count++
  }
  return count / pixelCount
}

export function showNumberChannelCount() {
  return pixelCount
}

export function showNumberRotationPeriod() {
  if (colorRotationSpeed == 0) return 0  // Stopped
  return 1.0 / (colorRotationSpeed * 1000)  // Period in seconds
}

// ============================================================================
// DECAY FUNCTIONS
// ============================================================================

function decaySaturation(currentSat, age) {
  // Only applies to the maxFrequency pixel (others stay at 1.0)
  if (currentSat >= 1.0) return 1.0  // Already full color
  if (age >= SATURATION_RECOVERY_TIME) return 1.0
  // Linear recovery: 0 (white) → 1 (rainbow color)
  return age / SATURATION_RECOVERY_TIME
}

// ============================================================================
// beforeRender - Called once per frame
// ============================================================================

export function beforeRender(delta) {
  // ============================================================================
  // 1. AUDIO INPUT PROCESSING
  // ============================================================================

  if (light == -1 || simulateAudio) {
    simulateSound()
  }

  // ============================================================================
  // 1.5 RAINBOW COLOR ROTATION
  // ============================================================================

  // Rotate rainbow colors across the strip
  hueOffset = (hueOffset + delta * colorRotationSpeed) % 1.0

  // ============================================================================
  // 2. AUTOMATIC GAIN CONTROL (AGC) - aligned with audio-lights.js
  // ============================================================================

  // Feedback based on either max frequency or average energy
  var feedbackValue = useEnergyAverage ? energyAverage : maxFrequencyMagnitude
  lastVal = pow(feedbackValue * sensitivity, 2)
  calcVal = lastVal

  // Run PI controller only when there's actual audio content
  // This prevents AGC from boosting sensitivity in quiet/silent environments
  // Threshold based on measured energyAverage during conversation (~0.0005-0.001)
  if (feedbackValue > 0.0003) {  // Threshold for meaningful audio
    agcSensitivity = calcPIController(pic, brightness - calcVal)
  }

  // Apply the user's multiplier every frame, independent of the AGC gate above,
  // so the slider still has an effect when there's no audio to trigger AGC
  sensitivity = agcSensitivity * userSensitivityMult

  // Update UI gauges
  timer += delta
  if (timer > waitTime) {
    timer -= waitTime
    undershoot = brightness - calcVal
    overshoot = calcVal - brightness
    displayedSensitivity = sensitivity
  }

  // ============================================================================
  // 3. PER-PIXEL FREQUENCY MAPPING, TRIGGERING & DECAY
  // ============================================================================

  var maxFreqPixel = freqToPixelIndex(maxFrequency)

  for (i = 0; i < pixelCount; i++) {
    pixelDecayAge[i] += delta

    var triggered = false

    if (frequencyData) {
      // Interpolate this pixel's magnitude between its two nearest bins
      // (inlined - a function call here costs more than the math itself)
      var binPos = pixelFreq[i] / BIN_HZ
      var binLow = floor(binPos)
      var weight = binPos - binLow
      var rawMag = mix(frequencyData[binLow], frequencyData[binLow + 1], weight)
      var scaledMag = rawMag * sensitivity
      var newValue = clamp(scaledMag, MIN_BRIGHTNESS, 1.0)

      // Trigger threshold, and only if it beats the current (still-decaying) value
      if (scaledMag > 0.15 && newValue > pixelValues[i]) {
        pixelValues[i] = newValue
        pixelTriggered[i] = newValue
        pixelDecayAge[i] = 0
        triggered = true
      }
    }

    if (!triggered) {
      // Inlined decay curve, with a fast path for the common fully-decayed
      // case so most pixels skip straight past the pow() call entirely
      if (pixelDecayAge[i] >= DECAY_TIME) {
        pixelValues[i] = MIN_BRIGHTNESS
      } else {
        var normalized = pixelDecayAge[i] / DECAY_TIME
        var decayed = pixelTriggered[i] * pow(1 - normalized, 0.8)
        pixelValues[i] = max(MIN_BRIGHTNESS, decayed)
      }
    }

    // Only the maxFrequency pixel turns white (and only one at a time)
    if (triggered && i == maxFreqPixel) {
      if (currentWhitePixel >= 0 && currentWhitePixel != i) {
        pixelSaturations[currentWhitePixel] = 1.0
      }
      pixelSaturations[i] = 0  // White
      currentWhitePixel = i
      whitePixelAge = 0
    }
  }

  // Saturation only ever differs from 1.0 for the one recovering white pixel,
  // so recover just that one instead of scanning decaySaturation over all 574
  if (currentWhitePixel >= 0) {
    whitePixelAge += delta
    pixelSaturations[currentWhitePixel] = decaySaturation(pixelSaturations[currentWhitePixel], whitePixelAge)
    if (pixelSaturations[currentWhitePixel] >= 1.0) currentWhitePixel = -1
  }
}

// ============================================================================
// render - Called for each pixel
// ============================================================================

export function render(index) {
  // Rainbow hue for this pixel (red=low freq → blue=high freq, plus rotation)
  var h = (0.67 * index / (pixelCount - 1) + hueOffset) % 1.0
  var s = pixelSaturations[index]
  var v = pixelValues[index]

  // Apply gamma correction
  var vGamma = v * v

  // Set pixel color
  hsv(h, s, vGamma)
}

// ============================================================================
// AUDIO SIMULATION
// ============================================================================

var simTime = 0

function simulateSound() {
  simTime += 16

  var sweepPeriod = 10000
  var sweepProgress = (simTime % sweepPeriod) / sweepPeriod

  // Sweep through frequency range
  var simFreq = SPEECH_MIN_FREQ + sweepProgress * (SPEECH_MAX_FREQ - SPEECH_MIN_FREQ)

  // Varying amplitude - realistic range based on sensor board (0.01-0.1)
  var simMagnitude = 0.02 + 0.06 * wave(sweepProgress)

  maxFrequency = simFreq
  maxFrequencyMagnitude = simMagnitude

  if (!frequencyData) {
    frequencyData = array(32)
  }

  // Set bins near simulated frequency with varying magnitudes
  var totalEnergy = 0
  for (i = 0; i < 32; i++) {
    var binFreq = i * 312.5
    var distFromMax = abs(binFreq - simFreq)
    if (distFromMax < 500) {
      // Magnitude falls off with distance from max frequency
      var falloff = 1.0 - (distFromMax / 500)
      frequencyData[i] = simMagnitude * falloff
      totalEnergy += frequencyData[i]
    } else {
      frequencyData[i] = 0
    }
  }

  // Calculate average energy (simulate sensor board behavior)
  energyAverage = totalEnergy / 32
}
