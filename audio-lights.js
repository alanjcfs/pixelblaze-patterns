
/*
  Sound - rays

  This pattern is designed to use the sensor expansion board, but falls back to
  simulated sound data if the sensor board isn't detected.

  The beginning of the strip will originate pixels with color based on the most
  prevalent frequency in the sound, and brightness based on the magnitude. Those
  rays of color will then travel down the strip.

  Please check out the "sound - blink fade" pattern for more verbose comments
  explaining the PI controller used below for automatic gain control.
*/

// ============================================================================
// CONFIGURATION - LED Strip Layout (574 pixels total)
// ============================================================================
// Wall segments: lights flow from corners toward the center of each wall
// Wall 1: 188 pixels (indices 0-187)   - split at pixel 94
// Wall 2: 198 pixels (indices 188-385) - split at pixel 287
// Wall 3: 188 pixels (indices 386-573) - split at pixel 480

var WALL_1_SIZE = 188  // First wall pixel count
var WALL_2_SIZE = 198  // Second wall pixel count
var WALL_3_SIZE = 188  // Third wall pixel count

var WALL_1_START = 0
var WALL_1_CENTER = WALL_1_START + floor(WALL_1_SIZE / 2)  // 94

var WALL_2_START = WALL_1_START + WALL_1_SIZE  // 188
var WALL_2_CENTER = WALL_2_START + floor(WALL_2_SIZE / 2)  // 287

var WALL_3_START = WALL_2_START + WALL_2_SIZE  // 386
var WALL_3_CENTER = WALL_3_START + floor(WALL_3_SIZE / 2)  // 480

// Speed that the rays travel down the strip (pixels per millisecond)
export var speed = 38.3/1000

// These vars are set by the external sensor board, if one is connected. We
// don't actually use light readings in this pattern, so if the `light` value
// remains -1, no sensor board is connected.
export var light = -1 
export var maxFrequencyMagnitude
export var maxFrequency
export var sensitivity = 300
// A position pointer, in pixels, that turns hues[] and vals[] into a circular
// buffer
pos = 0
calcVal = 0
// Stores the last brightness value to feed back into the PI gain controller 
export var lastVal = .25
var lumensity = 32767 / 2
export var pixensity = .5

hues = array(pixelCount)
vals = array(pixelCount)
writ = array(pixelCount)  // Flow direction mapping array
var rotateColors = false
timer = 0
waitTime = 1000
undershoot = overshoot = dsensitivity = 0

// ============================================================================
// Initialize flow direction mapping
// ============================================================================
// Each wall is split in half. Lights flow from both corners to the center.
// First half of each wall: normal flow (corner → center)
// Second half of each wall: reverse flow (corner → center)

for (i = 0; i < pixelCount; i++) {
  // Wall 1 - First half (0 to 93): Flow forward from corner 1 to center
  if (i < WALL_1_CENTER) {
    writ[i] = i
  }
  // Wall 1 - Second half (94 to 187): Flow backward from corner 2 to center
  else if (i < WALL_2_START) {
    writ[i] = WALL_2_START - 1 - i + WALL_1_CENTER
  }
  // Wall 2 - First half (188 to 286): Flow forward from corner 2 to center
  else if (i < WALL_2_CENTER) {
    writ[i] = i
  }
  // Wall 2 - Second half (287 to 385): Flow backward from corner 3 to center
  else if (i < WALL_3_START) {
    writ[i] = WALL_3_START - 1 - i + WALL_2_CENTER
  }
  // Wall 3 - First half (386 to 479): Flow forward from corner 3 to center
  else if (i < WALL_3_CENTER) {
    writ[i] = i
  }
  // Wall 3 - Second half (480 to 573): Flow backward from corner 4 to center
  else {
    writ[i] = pixelCount - 1 - i + WALL_3_CENTER
  }
}

function roundEven(num) {
  return round(num/2)*2
}

export var sliderNumerity = function(val) {
  pixensity = roundEven((0.001 + (.999-.001)*val)*100)/100
  opposed = .5 + (2-.5)*val
  target = pow(pixensity/2, opposed)
  lumensity = pic[4] = 500 + (pow(2, 13)-500)*pixensity
}

export function showNumberN() {
  return pixensity
}

export var sliderProportional = function(val) {
  pic[0] = roundEven(val*100)/100
}
export var showNumberP = function() {
  return pic[0]
}

export function sliderIntegral(val) {
  pic[1] = roundEven(val*100)/100
}
export function showNumberI() {
  return pic[1]
}

export var togglerotateColors = function(bool) {
  rotateColors = bool
}
export function gaugeUndershoot() {
  return undershoot
}

export function gaugeOvershoot() {
  return overshoot
}

export function showNumberSensitivity() {
  return dsensitivity
}

// ============================================================================
// PI Controller for automatic gain control
// ============================================================================
// The PI (Proportional-Integral) controller automatically adjusts sensitivity
// to maintain consistent brightness despite varying audio levels.
// pic[0] = kp (proportional gain), pic[1] = ki (integral gain)
// pic[2] = integral accumulator, pic[3] = min, pic[4] = max
var pic = makePIController(0.055, .355, 2048, 0, lumensity)

// Create a new PI Controller with specified parameters
function makePIController(kp, ki, start, min, max) {
  pic = array(5)
  pic[0] = kp  // Proportional gain
  pic[1] = ki  // Integral gain
  pic[2] = start  // Initial integral value
  pic[3] = min  // Minimum output value
  pic[4] = max  // Maximum output value
  return pic
}
export var gainProportional, gainIntegral, errorPrev, calcmean, calcVal;

// Calculate PI controller output with derivative component
function calcPIController(pic, err) {
  // Update integral term with clamping to prevent windup
  pic[2] = clamp(pic[2] + err, pic[3], pic[4])

  // Calculate each component of the PID-like controller
  diff = errorPrev - err
  gainProportional = pic[0] * err  // Proportional: immediate response to error
  gainIntegral = pic[1] * pic[2]  // Integral: accumulated error over time
  gainDiff = diff * .125  // Derivative: rate of change dampening
  errorPrev = err

  // Combine all gains and clamp the output
  return clamp(gainProportional + gainIntegral + gainDiff, .5, 900)
}

// ============================================================================
// beforeRender - Called once per frame before rendering pixels
// ============================================================================
export function beforeRender(delta) {
  // Use the last calculated brightness value as feedback for the PI controller
  // The PI controller aims to keep brightness around pixensity (default 0.5)
  calcVal = lastVal
  sensitivity = calcPIController(pic, pixensity - calcVal)  // error = setpoint - measuredValue

  // Advance the position pointer to make rays travel down the strip
  // This creates a circular buffer effect in the hues[] and vals[] arrays
  pos = (pos + speed * delta) % pixelCount

  // Use simulated sound if no sensor board is connected
  if (light == -1) simulateSound()

  // Calculate brightness from audio magnitude and store it at current position
  // The brightness is our feedback signal to the PI controller
  lastVal = pow(maxFrequencyMagnitude * sensitivity, 2)
  vals[pos] = lastVal

  // Update UI gauges periodically
  timer += delta
  if (timer > waitTime) {
    timer -= waitTime
    undershoot = pixensity - calcVal
    overshoot = calcVal - pixensity
    dsensitivity = sensitivity
  }

  // Map audio frequency to hue (0-5000 Hz maps to full color wheel)
  // Lower frequencies = red/orange, higher frequencies = blue/purple
  hues[pos] = maxFrequency / 5000

  // Time variable for gradual hue rotation
  t1 = time(12 / 65.536)
}

// Helper function to map physical pixel index to circular buffer position
function newPosition(x) {
  return ((pixelCount - x) + pos) % pixelCount
}

// ============================================================================
// render - Called for each pixel to set its color
// ============================================================================
export function render(index) {
  // Apply flow direction mapping, then map to circular buffer position
  // This makes rays travel from corners to centers of each wall
  index = newPosition(writ[index % pixelCount])

  // Get the hue for this pixel from the circular buffer
  h = hues[index]

  // Optional: Add gradual color rotation over time and position
  // This creates a rainbow gradient effect that slowly moves
  // Toggle with the "rotateColors" UI control
  h += rotateColors ? index / pixelCount / 4 + t1 : h

  // Get brightness value and apply gamma correction for smoother dimming
  v = vals[index]
  vsq = v * v  // Gamma correction

  // Set the pixel color (full saturation, variable brightness)
  hsv(h, 1, vsq)
}

// Simulate sound data when no sensor board is connected
// Generates random frequency values for testing the pattern
function simulateSound() {
  maxFrequency += random(5000)
  maxFrequencyMagnitude = .5
}
