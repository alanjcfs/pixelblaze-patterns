// delta indicates the amount of time in ms between each beforeRender calls. To ensure things happen in a second, divide
// 1000 ms by delta

var CLOCK_CYCLE = 65.536;
var deltatime = 0;
var smallstep = 30;
export var frequencyData;
export var maxFrequencyMagnitude;
export var maxFrequency;
var NUM_CHANS = 22;
var NUM_FREQS = 32;
var channels = array(NUM_CHANS);
var hues = array(NUM_CHANS);
var pic = makePIController(0.05, 0.35, 900, 0, pow(2,11))
export var sensitivity;
var target = 0.5;
minThreshold = 0;
// map frequencyData to NUM_OF_CHANNELS
// NUM_FREQS / 22 = 1.45454545

function roundToEven(num) {
  var decimal = frac(num)
  var integer = trunc(num)
  if (decimal == 0.5 || decimal == -0.5) {
    if (integer % 2 == 0)
      return integer
    else {
      return integer + 1
    }
  }

  return round(num);
}

export function sliderDecayRate(val) {
  fade = sqrt(0.748 + (.25 - 0)/(1-0)*val)
}

export function gaugeOvershoot() {
  return avgVal - target
}

export function gaugeUndershoot() {
  return target - avgVal
}

export function showNumberSensitivity() {
  return sensitivity
}

export function toggleUseMinThreshold(val) {
  minThreshold = val ? 0.125 : 0
}

function makePIController(kp, ki, start, min, max) {
  var pic = array(5)
  pic[0] = kp; pic[1] = ki; pic[2] = start; pic[3] = min; pic[4] = max
  return pic
}

export var diff = 0, errPrev = 0
function calcPIController(pic, err) {
  pic[2] = clamp(pic[2] + err, pic[3], pic[4])
  diff = err - errPrev
  gainP = pic[0] * err
  gainI = pic[1] * pic[2]
  errPrev = err
  return max(gainP + gainI, 0.5)
}

var avgVal = 0, lastVal = 0, calcVal = 0, intervals = array(NUM_CHANS), t2 = 0;

export function beforeRender(delta) {
  deltatime += delta
  while (deltatime > smallstep) {
    // map frequencyData to NUM_CHANS channels
    avgVal = sqrt(((channels.sum() / NUM_CHANS) + lastVal) / 2)
    lastVal = pow(maxFrequencyMagnitude * sensitivity, 2)
    sensitivity = calcPIController(pic, target - avgVal)

    frequencyData.forEach(function(x, i) {
      calcVal = clamp(pow(x * sensitivity, 2), 0, 1)
      idx = trunc(NUM_CHANS / NUM_FREQS * i)
      fx = frac(NUM_CHANS / NUM_FREQS * i)

      if (calcVal > channels[idx]) {
        channels[idx] = sqrt(calcVal * (1-fx));
        intervals[idx] = 1;
      } else {
        channels[idx] = channels[idx]*fade//+diff
      }
      if (calcVal > channels[(idx+1) % NUM_CHANS]) {
        channels[(idx+1) % NUM_CHANS] = sqrt(calcVal * fx)
        intervals[(idx+1) % NUM_CHANS] = 1;
      }
    })

    t1 = time(30 / CLOCK_CYCLE)
    deltatime -= smallstep
  }
}

export function render(index) {
  index = pixelCount - 1 - index
  i = floor(index / pixelCount * NUM_CHANS)
  h = index / pixelCount + t1
  s = 1
  v = pow(channels[i], 2)
  v = v > minThreshold ? v : 0
  hsv(h, s, v)
}

