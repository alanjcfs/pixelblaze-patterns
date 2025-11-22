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


// Speed that the rays travel down the strip
export var speed = 38.3/1000 // pixelCount / numberOfSeconds to traverse entire strip / 1000 milliseconds

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
var maxSensitivity = 2500
var brightness = .5

// Monitoring variables to determine appropriate maxSensitivity and starting sensitivity
export var minMFM = 1, maxMFM = 0  // Observed range of maxFrequencyMagnitude
export var minSens = 9999, maxSens = 0  // Observed range of sensitivity

hues = array(pixelCount)
vals = array(pixelCount)
writ = array(pixelCount)
var rotateColors = false
timer = 0
waitTime = 1000
undershoot = overshoot = dsensitivity = 0

for (i=0;i<pixelCount;i++) {
  // First establish normal flow
  if (i < 94 || (i >= 188 && i < 287) || (i >= 386 && i < 480) ) {
    writ[i] = i;
  // then establish opposite
  // second corner
  }
  else if (i < 188) {
    writ[i] = 188 - i + 93
  }
  else if (i < 386) {
    writ[i] = 386  - i + 286
  }
  else {
    writ[i] = pixelCount - i + 479
  }
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

var pic = makePIController(0.05, .35, 30, 0, maxSensitivity)

// Make a new PI Controller
function makePIController(kp, ki, start, min, max) {
  pic = array(5)
  pic[0] = kp
  pic[1] = ki
  pic[2] = start
  pic[3] = min
  pic[4] = max
  return pic
}
export var gainProportional, gainIntegral, errorPrev, calcmean, calcVal;
function calcPIController(pic, err) {
  // proportional = err; integral = err + integral
  pic[2] = clamp(pic[2] + err, pic[3], pic[4])
  gainProportional = pic[0] * err
  gainIntegral = pic[1] * pic[2]
  return clamp(gainProportional + gainIntegral, pic[3], pic[4])
}

export function beforeRender(delta) {
  // Here the PI controller is aiming for a sensitivity based on chasing recent
  // maxFrequencyMagnitudes to be 0.5
  // calcmean = vals.sum() / pixelCount
  calcVal = lastVal // calcmean
  // calcVal = (vals[0] + vals[pixelCount/4] + vals[pixelCount/2] + vals[pixelCount-1] + lastVal)/5
  sensitivity = calcPIController(pic, brightness - calcVal)// error = setpoint - measuredValue

  // To make the rays travel along the strip, sweep a position offset pointer
  // down the arrays of values and hues
  pos = (pos + speed * delta) % pixelCount
  if (light == -1) simulateSound()  // No sensor board attached
  
  // The brightness value will be determined by the magnitude of the most
  // intense frequency. This is also our feedback to the PI controller.
  lastVal = pow(maxFrequencyMagnitude * sensitivity, 2)
  vals[pos] = lastVal
  
  // Track observed ranges for tuning
  if (maxFrequencyMagnitude > 0 && maxFrequencyMagnitude < minMFM) minMFM = maxFrequencyMagnitude
  if (maxFrequencyMagnitude > maxMFM) maxMFM = maxFrequencyMagnitude
  if (sensitivity < minSens) minSens = sensitivity
  if (sensitivity > maxSens) maxSens = sensitivity

  timer += delta
  if (timer > waitTime) {
    timer -= waitTime
    undershoot = brightness - calcVal
    overshoot = calcVal - brightness
    dsensitivity = sensitivity
  }

  /*
    The base color will be modified by time and strip position in render(), but
    its hue begins based on the most intense frequency detected. If you played a
    swept tone between 20 Hz and 5 KHz, it'd trace a rainbow. 
  */
  hues[pos] = maxFrequency / 5000

  // Used to subtly advance the hue over time
  t1 = time(12 / 65.536) // 65.536
}

function newPosition(x) {
  // y = pixelCount - x
  // z = y + pos
  // return z % pixelCount
  return ((pixelCount - x) + pos) % pixelCount
}

export function render(index) {
  // Shift the index circularly based on the position offset
  // if (index <= 93 || index > 188 && index < 286 || index > 378 && index < 479) {
  index = newPosition(writ[(index % pixelCount) % pixelCount])
  
  h = hues[index]
  /*
    This rotates color by adding a component based on time and position.  
    Comment this out to more clearly see the detected maximum frequencies.
    Adding `index / pixelCount / 4` adds a quarter of the hue wheel across the
    strip's entire length. Notice that since index is reversed, *adding* t1 back
    in has the effect of *slowing* the hue progression.
  */
  h += rotateColors ? index / pixelCount / 4 + t1 : h

  v = vals[index]
  vsq = v * v  // Gamma correction
  hsv(h, 1, vsq)
}

function simulateSound() {
  
  maxFrequency += random(5000)
  maxFrequencyMagnitude = .5
  
}
