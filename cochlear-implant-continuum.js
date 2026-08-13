/*
  Cochlear Implant - 32 Sections (matches sensor board bins directly)

  Earlier version of this file mapped each of the 574 pixels to its own
  log-spaced frequency and interpolated between the sensor board's 32 raw
  bins to fill in the gaps. That was expensive (574 interpolations/frame)
  and dropped fps well below cochlear-implant.js's 22-electrode design.

  This version instead uses exactly 32 sections - one per raw frequencyData
  bin, no interpolation, no log-frequency mapping, no speech-range
  filtering. Each section is just frequencyData[i] directly. Still one
  continuous strip (no wall-splitting mode), just blockier than the
  per-pixel version - trading resolution for a much cheaper beforeRender.

  Sensitivity is fixed (BASE_SENSITIVITY * slider), not auto-adjusted. This
  pattern used to have an AGC (PI controller) that normalized brightness to
  a constant target regardless of room volume - which meant a silent room
  would eventually get amplified until it looked just as bright as a loud
  one. That's the opposite of what this pattern is for: a quiet room should
  read dim, a loud room should read bright. Fixed sensitivity, calibrated
  by hand, preserves that distinction instead of erasing it.

  Visual effect:
  - Silence: Dim rainbow gradient always visible (red=low freq -> blue=high freq)
  - Section nearest maxFrequency: Flashes white, fades back to rainbow color
  - Other sections: Brighten in their own rainbow color, proportional to
    that bin's raw magnitude
  - Brightness decays smoothly per section after a peak, same envelope as
    cochlear-implant.js

  Designed for 574-pixel LED strip with sensor expansion board.
*/

// ============================================================================
// CONFIGURATION
// ============================================================================

var NUM_SECTIONS = 32  // Matches the sensor board's 32 frequency bins exactly
var PIXELS_PER_SECTION = floor(pixelCount / NUM_SECTIONS)  // ~17 pixels

var BIN_HZ = 312.5  // Approximate Hz per frequencyData bin

var DECAY_TIME = 5000  // Milliseconds for brightness decay
var SATURATION_RECOVERY_TIME = 250  // Ms for white → rainbow color (fast recovery)
var MIN_BRIGHTNESS = 0.25  // Minimum brightness for quiet sections (always visible)

// ============================================================================
// PER-SECTION STATE ARRAYS (one value per section, not per pixel)
// ============================================================================

export var sectionValues = array(NUM_SECTIONS)  // 0.0-1.0 (brightness) - exported for live debugging
var sectionSaturations = array(NUM_SECTIONS)  // 0.0-1.0 (1.0=rainbow color, 0.0=white)
var sectionDecayAge = array(NUM_SECTIONS)     // Milliseconds since last trigger
var sectionTriggered = array(NUM_SECTIONS)    // Peak brightness a section decays from

// Track which section is currently white (only one at a time) so saturation
// recovery only has to touch that one section instead of scanning all 32
var currentWhiteSection = -1
var whiteSectionAge = 0

// Rainbow rotation offset (0.0-1.0, wraps around)
var hueOffset = 0

for (i = 0; i < NUM_SECTIONS; i++) {
  sectionValues[i] = MIN_BRIGHTNESS   // Dim but visible
  sectionSaturations[i] = 1.0         // Full rainbow color
  sectionDecayAge[i] = DECAY_TIME * 2 // Fully decayed
  sectionTriggered[i] = MIN_BRIGHTNESS
}

// ============================================================================
// AUDIO PROCESSING - Sensor Board Variables
// ============================================================================

export var light = -1  // Ambient light sensor (-1 = no sensor board)
export var frequencyData  // 32-element array of frequency magnitudes
export var maxFrequencyMagnitude
export var maxFrequency
export var energyAverage  // Average energy across all frequency bins

// Sensitivity control - fixed, manually calibrated (no AGC).
// AGC was removed: it auto-normalizes to a constant target brightness
// regardless of how loud the room actually is, which fights the goal of a
// quiet room reading dim and a loud room reading bright. A fixed sensitivity
// lets brightness track actual loudness instead of erasing that difference.
var BASE_SENSITIVITY = 300  // Calibrate this against your room
export var sensitivity = 300  // BASE_SENSITIVITY * userSensitivityMult

var calcVal = 0  // Diagnostic readout only - no longer drives sensitivity

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
  sensitivity = BASE_SENSITIVITY * userSensitivityMult
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
  return sensitivity
}

// "Active" = still within the loud/decaying phase of its envelope, not just
// above the idle floor - keeps this independent of MIN_BRIGHTNESS tuning.
export function showNumberAvgSaturation() {
  var count = 0
  var sum = 0
  var activeWindow = DECAY_TIME * 0.3
  for (i = 0; i < NUM_SECTIONS; i++) {
    if (sectionDecayAge[i] < activeWindow) {
      sum += sectionSaturations[i]
      count++
    }
  }
  return count > 0 ? sum / count : 1.0
}

export function gaugeActiveSections() {
  var count = 0
  var activeWindow = DECAY_TIME * 0.3
  for (i = 0; i < NUM_SECTIONS; i++) {
    if (sectionDecayAge[i] < activeWindow) count++
  }
  return count / NUM_SECTIONS
}

export function showNumberChannelCount() {
  return NUM_SECTIONS
}

export function showNumberRotationPeriod() {
  if (colorRotationSpeed == 0) return 0  // Stopped
  return 1.0 / (colorRotationSpeed * 1000)  // Period in seconds
}

// ============================================================================
// DECAY FUNCTIONS
// ============================================================================

function decaySaturation(currentSat, age) {
  // Only applies to the maxFrequency section (others stay at 1.0)
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
  // 2. LOUDNESS READOUT (diagnostic only - sensitivity is fixed, see above)
  // ============================================================================

  var feedbackValue = useEnergyAverage ? energyAverage : maxFrequencyMagnitude
  calcVal = pow(feedbackValue * sensitivity, 2)

  // ============================================================================
  // 3. PER-SECTION TRIGGERING & DECAY - direct bin-to-section mapping
  // ============================================================================

  var maxFreqSection = round(maxFrequency / BIN_HZ)
  if (maxFreqSection < 0) maxFreqSection = 0
  if (maxFreqSection > NUM_SECTIONS - 1) maxFreqSection = NUM_SECTIONS - 1

  for (i = 0; i < NUM_SECTIONS; i++) {
    sectionDecayAge[i] += delta

    // Age has no reason to grow past DECAY_TIME - "fully decayed" is fully
    // decayed. Without this cap it climbs forever for any section that goes
    // a while without retriggering, until it overflows Pixelblaze's 16.16
    // fixed-point range (+/-32,768) and wraps to a large negative number,
    // which then evades the ">= DECAY_TIME" check below and feeds a garbage
    // "base" into pow(). Confirmed live via diagnostic instrumentation.
    if (sectionDecayAge[i] > DECAY_TIME) sectionDecayAge[i] = DECAY_TIME

    var triggered = false

    if (frequencyData) {
      var rawMag = frequencyData[i]  // Direct bin lookup - no interpolation needed
      var scaledMag = rawMag * sensitivity

      // Explicit bounds check, not clamp() - live testing showed sectionValues
      // exceeding 1.0 (up to 2.46 observed) even with clamp(scaledMag, MIN_BRIGHTNESS,
      // 1.0) here, which then reads as "stuck at 100%" since a value >1.0 still
      // renders as fully-on and takes extra time decaying back under 1.0 before
      // any dimming is even visible
      var newValue = scaledMag
      if (newValue < MIN_BRIGHTNESS) newValue = MIN_BRIGHTNESS
      if (newValue > 1.0) newValue = 1.0

      // Trigger threshold, and only if it beats the current (still-decaying) value
      if (scaledMag > 0.15 && newValue > sectionValues[i]) {
        sectionValues[i] = newValue
        sectionTriggered[i] = newValue
        sectionDecayAge[i] = 0
        triggered = true
      }
    }

    if (!triggered) {
      // Fast path for the common fully-decayed case skips the pow() call
      if (sectionDecayAge[i] >= DECAY_TIME) {
        sectionValues[i] = MIN_BRIGHTNESS
      } else {
        var normalized = sectionDecayAge[i] / DECAY_TIME
        var decayed = sectionTriggered[i] * pow(1 - normalized, 0.8)
        // Decaying from a peak should never end up brighter than that peak -
        // don't trust pow() not to violate that if given a fractional exponent
        if (decayed > sectionTriggered[i]) decayed = sectionTriggered[i]
        sectionValues[i] = max(MIN_BRIGHTNESS, decayed)
      }
    }

    // Only the maxFrequency section turns white (and only one at a time)
    if (triggered && i == maxFreqSection) {
      if (currentWhiteSection >= 0 && currentWhiteSection != i) {
        sectionSaturations[currentWhiteSection] = 1.0
      }
      sectionSaturations[i] = 0  // White
      currentWhiteSection = i
      whiteSectionAge = 0
    }
  }

  // Saturation only ever differs from 1.0 for the one recovering white section,
  // so recover just that one instead of scanning decaySaturation over all 32
  if (currentWhiteSection >= 0) {
    whiteSectionAge += delta
    sectionSaturations[currentWhiteSection] = decaySaturation(sectionSaturations[currentWhiteSection], whiteSectionAge)
    if (sectionSaturations[currentWhiteSection] >= 1.0) currentWhiteSection = -1
  }
}

// ============================================================================
// render - Called for each pixel
// ============================================================================

export function render(index) {
  var section = floor(index / PIXELS_PER_SECTION)
  if (section >= NUM_SECTIONS) section = NUM_SECTIONS - 1

  // Rainbow hue for this section (red=low freq → blue=high freq, plus rotation)
  var h = (0.67 * section / (NUM_SECTIONS - 1) + hueOffset) % 1.0
  var s = sectionSaturations[section]
  var v = sectionValues[section]

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
  simTime = simTime % sweepPeriod  // same unbounded-accumulator risk as sectionDecayAge
  var sweepProgress = simTime / sweepPeriod

  // Sweep across the full bin range so all 32 sections light up
  var simFreq = sweepProgress * (NUM_SECTIONS - 1) * BIN_HZ

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
    var binFreq = i * BIN_HZ
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
