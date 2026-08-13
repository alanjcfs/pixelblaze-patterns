/*
  Cochlear Implant - 22 Electrode Simulation

  Simulates a cochlear implant with 22 electrodes/channels.
  - 574 pixels divided into 22 segments (~26 pixels each)
  - Each segment represents a frequency band (like one electrode)
  - Rainbow gradient base: red (low freq) → blue (high freq)
  - Amplitude controls spatial size within each segment

  Visual effect:
  - Silence: Dim rainbow gradient always visible
  - maxFrequency segment: Flashes white, fades back to rainbow color
  - Other active segments: Brighten in their own rainbow color
  - Brightness proportional to frequencyData / maxFrequencyMagnitude

  Designed for 574-pixel LED strip with sensor expansion board.
*/

// ============================================================================
// CONFIGURATION - 22 Electrode Segments
// ============================================================================

var NUM_ELECTRODES = 22  // Number of cochlear implant electrodes to simulate
var PIXELS_PER_ELECTRODE = floor(pixelCount / NUM_ELECTRODES)  // ~26 pixels

var DECAY_TIME = 5000  // Milliseconds for brightness decay
var SATURATION_RECOVERY_TIME = 250  // Ms for white → rainbow color (fast recovery)
var MIN_BRIGHTNESS = 0.25  // Minimum brightness for quiet segments (always visible)

// Frequency range for speech (cochlear implant typical range)
var SPEECH_MIN_FREQ = 200   // Hz - lowest frequency
var SPEECH_MAX_FREQ = 8000  // Hz - highest frequency

// ============================================================================
// SEGMENT STATE ARRAYS (one value per electrode/segment, not per pixel)
// ============================================================================

// Each of 22 segments maintains its own HSV state and amplitude
var baseHues = array(NUM_ELECTRODES)            // Fixed rainbow hue per electrode (red=0, blue=0.67)
var segmentValues = array(NUM_ELECTRODES)       // 0.0-1.0 (brightness)
var segmentSaturations = array(NUM_ELECTRODES)  // 0.0-1.0 (1.0=rainbow color, 0.0=white)
var segmentDecayAge = array(NUM_ELECTRODES)     // Milliseconds since last trigger
var segmentAmplitude = array(NUM_ELECTRODES)    // 0.0-1.0 (controls segment size)

// Track which electrode is currently white (only one at a time)
var currentWhiteElectrode = -1

// Rainbow rotation offset (0.0-1.0, wraps around)
var hueOffset = 0

// Initialize rainbow gradient (red=low freq, blue=high freq)
for (i = 0; i < NUM_ELECTRODES; i++) {
  baseHues[i] = 0.67 * i / (NUM_ELECTRODES - 1)  // Red (0) → Blue (21)
  segmentValues[i] = MIN_BRIGHTNESS  // Dim but visible
  segmentSaturations[i] = 1.0  // Full rainbow color
  segmentDecayAge[i] = DECAY_TIME * 2  // Fully decayed
  segmentAmplitude[i] = 0  // No active pixels beyond minimum
}

// ============================================================================
// FREQUENCY BAND MAPPING - Logarithmic (like real cochlear implants)
// ============================================================================

// Calculate logarithmically-spaced frequency bands for each electrode
// Real cochlear implants use log spacing because human hearing is logarithmic
var electrodeFreqBands = array(NUM_ELECTRODES + 1)  // Band edges (23 values for 22 bands)

function initializeFrequencyBands() {
  var logMin = log2(SPEECH_MIN_FREQ)
  var logMax = log2(SPEECH_MAX_FREQ)
  var logStep = (logMax - logMin) / NUM_ELECTRODES

  for (i = 0; i <= NUM_ELECTRODES; i++) {
    electrodeFreqBands[i] = pow(2, logMin + i * logStep)
  }
}
initializeFrequencyBands()

// Map frequency to electrode/segment index
function freqToElectrode(freq) {
  // Clamp to speech range
  freq = clamp(freq, SPEECH_MIN_FREQ, SPEECH_MAX_FREQ)

  // Find which band this frequency falls into
  for (var e = 0; e < NUM_ELECTRODES; e++) {
    if (freq >= electrodeFreqBands[e] && freq < electrodeFreqBands[e + 1]) {
      return e
    }
  }
  return NUM_ELECTRODES - 1  // Fallback to highest electrode
}

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
// MODE SWITCHING
// ============================================================================

// Mode 0: Entire strip as one (574 pixels)
// Mode 1: Split into three walls
export var mode = 0

// Wall configuration (for split mode)
var WALL1_START = 0
var WALL1_END = 187      // 188 pixels
var WALL2_START = 188
var WALL2_END = 385      // 198 pixels (middle wall is longer)
var WALL3_START = 386
var WALL3_END = 573      // 188 pixels

var WALL1_LENGTH = 188
var WALL2_LENGTH = 198
var WALL3_LENGTH = 188

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

export function toggleMode(bool) {
  mode = bool ? 1 : 0  // false = 0 (entire strip), true = 1 (three walls)
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

export function showNumberAvgSaturation() {
  var count = 0
  var sum = 0
  for (i = 0; i < NUM_ELECTRODES; i++) {
    if (segmentAmplitude[i] > 0.1) {
      sum += segmentSaturations[i]
      count++
    }
  }
  return count > 0 ? sum / count : 1.0
}

export function gaugeActiveElectrodes() {
  var count = 0
  for (i = 0; i < NUM_ELECTRODES; i++) {
    if (segmentAmplitude[i] > 0.1) {
      count++
    }
  }
  return count / NUM_ELECTRODES
}

export function showNumberElectrodeCount() {
  return NUM_ELECTRODES
}

export function showNumberRotationPeriod() {
  if (colorRotationSpeed == 0) return 0  // Stopped
  return 1.0 / (colorRotationSpeed * 1000)  // Period in seconds
}

// ============================================================================
// ELECTRODE TRIGGERING - Amplitude Controls Segment Size
// ============================================================================

function triggerElectrode(electrodeIndex, rawMagnitude, isMaxFreq) {
  // Brightness based on scaled magnitude
  var scaledMag = rawMagnitude * sensitivity
  var newBrightness = clamp(scaledMag, MIN_BRIGHTNESS, 1.0)

  // Only update brightness if new value is greater than current
  // This prevents sudden dimming; decay handles gradual fade
  if (newBrightness > segmentValues[electrodeIndex]) {
    segmentValues[electrodeIndex] = newBrightness
    triggeredValues[electrodeIndex] = newBrightness  // Store for decay
    segmentDecayAge[electrodeIndex] = 0  // Reset decay timer only when brightness increases
  }

  // Only maxFrequency segment turns white (and only one at a time)
  if (isMaxFreq) {
    // Reset previous white electrode to full saturation
    if (currentWhiteElectrode >= 0 && currentWhiteElectrode != electrodeIndex) {
      segmentSaturations[currentWhiteElectrode] = 1.0
    }
    segmentSaturations[electrodeIndex] = 0  // White
    currentWhiteElectrode = electrodeIndex
  }
  // Other segments keep their rainbow color (saturation stays at 1.0)

  // Set amplitude (controls how many pixels light up in this segment)
  segmentAmplitude[electrodeIndex] = clamp(scaledMag, 0, 1.0)
}

// ============================================================================
// DECAY FUNCTIONS
// ============================================================================

// No hue decay - hue is fixed per electrode (baseHues)

function decayValue(age, startValue) {
  // Fade from triggered brightness to minimum
  // Using gentler decay curve (exponent 0.8 instead of 2) to reduce strobe effect
  if (age >= DECAY_TIME) return MIN_BRIGHTNESS
  var normalized = age / DECAY_TIME
  var decayed = startValue * pow(1 - normalized, 0.8)  // Slower fade
  return max(MIN_BRIGHTNESS, decayed)
}

function decaySaturation(currentSat, age) {
  // Only applies to maxFrequency segment (others stay at 1.0)
  if (currentSat >= 1.0) return 1.0  // Already full color
  if (age >= SATURATION_RECOVERY_TIME) return 1.0
  // Linear recovery: 0 (white) → 1 (rainbow color)
  return age / SATURATION_RECOVERY_TIME
}

function decayAmplitude(age) {
  // Amplitude decays faster - segment shrinks quickly
  if (age >= DECAY_TIME * 0.3) return 0.0
  var normalized = age / (DECAY_TIME * 0.3)
  return max(0, 1.0 - pow(normalized, 1.5))  // Fast shrink
}

// ============================================================================
// beforeRender - Called once per frame
// ============================================================================

// Store triggered brightness for decay calculation
var triggeredValues = array(NUM_ELECTRODES)
for (i = 0; i < NUM_ELECTRODES; i++) {
  triggeredValues[i] = MIN_BRIGHTNESS
}

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
  // 3. FREQUENCY BIN PROCESSING - Map to Electrodes
  // ============================================================================

  // Identify maxFrequency electrode
  var maxFreqElectrode = freqToElectrode(maxFrequency)

  if (frequencyData) {
    // Process each frequency bin (32 bins from sensor board)
    for (var binIndex = 0; binIndex < 32; binIndex++) {
      // Estimate frequency for this bin
      // Rough approximation: bin i ≈ i * 312.5 Hz
      var freq = binIndex * 312.5

      // Skip bins outside speech range
      if (freq < SPEECH_MIN_FREQ || freq > SPEECH_MAX_FREQ) {
        continue
      }

      // Get raw magnitude for this bin (before sensitivity scaling)
      var rawMag = frequencyData[binIndex]
      var scaledMag = rawMag * sensitivity

      // Trigger threshold
      if (scaledMag > 0.15) {
        // Map frequency to electrode
        var electrode = freqToElectrode(freq)

        // Is this the maxFrequency electrode?
        var isMaxFreq = (electrode == maxFreqElectrode)

        // Trigger the electrode with this amplitude
        // If multiple bins map to same electrode, use the highest magnitude
        if (scaledMag > segmentAmplitude[electrode] || segmentDecayAge[electrode] > 100) {
          triggerElectrode(electrode, rawMag, isMaxFreq)
        }
      }
    }
  }

  // ============================================================================
  // 4. DECAY UPDATES FOR ALL ELECTRODES
  // ============================================================================

  for (i = 0; i < NUM_ELECTRODES; i++) {
    // Increment decay age
    segmentDecayAge[i] += delta

    // Update values (no hue decay - hue is fixed)
    segmentValues[i] = decayValue(segmentDecayAge[i], triggeredValues[i])
    segmentSaturations[i] = decaySaturation(segmentSaturations[i], segmentDecayAge[i])

    // Update amplitude (segment shrinks during decay)
    segmentAmplitude[i] = decayAmplitude(segmentDecayAge[i])
  }
}

// ============================================================================
// render - Called for each pixel
// ============================================================================

export function render(index) {
  var electrode, posInSegment, pixelsPerElectrode

  if (mode == 0) {
    // MODE 0: Entire strip as one
    pixelsPerElectrode = PIXELS_PER_ELECTRODE
    electrode = floor(index / pixelsPerElectrode)
    if (electrode >= NUM_ELECTRODES) electrode = NUM_ELECTRODES - 1
    posInSegment = index - (electrode * pixelsPerElectrode)
  } else {
    // MODE 1: Split into three walls, each showing full visualization
    var wallLength, wallStart

    if (index <= WALL1_END) {
      // Wall 1: pixels 0-187
      wallLength = WALL1_LENGTH
      wallStart = WALL1_START
    } else if (index <= WALL2_END) {
      // Wall 2: pixels 188-385 (middle, longer)
      wallLength = WALL2_LENGTH
      wallStart = WALL2_START
    } else {
      // Wall 3: pixels 386-573
      wallLength = WALL3_LENGTH
      wallStart = WALL3_START
    }

    // Position within this wall (0 to wallLength-1)
    var posInWall = index - wallStart

    // Calculate electrode and position for this wall
    pixelsPerElectrode = wallLength / NUM_ELECTRODES
    electrode = floor(posInWall / pixelsPerElectrode)
    if (electrode >= NUM_ELECTRODES) electrode = NUM_ELECTRODES - 1
    posInSegment = posInWall - (electrode * pixelsPerElectrode)
  }

  // Center pixel of this segment
  var centerPixel = pixelsPerElectrode / 2

  // Distance from center (in pixels)
  var distFromCenter = abs(posInSegment - centerPixel)

  // Rainbow hue for this electrode (base hue + rotation offset)
  var h = (baseHues[electrode] + hueOffset) % 1.0
  var s = segmentSaturations[electrode]
  var v = segmentValues[electrode]

  // Calculate how many pixels should be lit based on amplitude
  // amplitude=0 → 0 pixels, amplitude=1.0 → full segment radius
  var litRadius = segmentAmplitude[electrode] * (pixelsPerElectrode / 2)

  // Is this pixel within the lit region?
  if (distFromCenter <= litRadius) {
    // Inside active region - full brightness with edge fade
    var edgeFade = 1.0 - (distFromCenter / (litRadius + 1))
    v = v * pow(edgeFade, 0.5)  // Gentle gradient
  } else {
    // Outside active region - minimum brightness (dim rainbow always visible)
    v = MIN_BRIGHTNESS
  }

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
