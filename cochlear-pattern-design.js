# Cochlear Implant LED Pattern - Design Document

## Project Overview

Create an audio-reactive LED pattern for Pixelblaze that visualizes sound similar to how a cochlear implant processes audio. The pattern uses a persistence-of-vision approach where frequently-occurring frequencies accumulate color intensity, while infrequent sounds create colorful trails that fade over time.

## Hardware Configuration

- **Total Pixels**: 574 LEDs arranged on crown molding
- **Layout**: Three walls (188 + 198 + 188 pixels)
- **Audio Input**: Pixelblaze sensor expansion board (with fallback to simulated audio)
- **Controller**: Pixelblaze using JavaScript-like language with limitations

## Core Concept

Each pixel position represents a specific audio frequency. When that frequency is detected in the audio signal:

1. **Blue light triggers** at the corresponding pixel position
2. **Color decay progression**: Blue → Cyan → Green → Yellow → Red → Dark (over 5 seconds)
3. **Retriggering**: New audio at that frequency adds blue, even if pixel is currently green/red
4. **Persistence effect**: Frequently-triggered frequencies appear white (RGB channels all active), while occasional sounds show colored trails

This creates an intuitive visualization where:
- **Constant speech/music** = bright white pixels
- **Intermittent sounds** = colored spectrum trails
- **Silence** = darkness

## Technical Specifications

### Frequency Mapping

**Target Range**: Human speech frequencies (approximately 200 Hz - 8,000 Hz)

**Pixelblaze Audio Limitations**:
- `frequencyData` array contains 32 frequency bins
- Each bin represents a range of frequencies
- Bins are distributed from ~0 Hz to ~10,000 Hz (varies by sample rate)
- We'll map the 32 bins across the 574 pixels, focusing on speech-relevant frequencies

**Spatial Layout**:
- Continuous frequency spectrum mapped left-to-right across all three walls
- Lower frequencies start at pixel 0 (left side of Wall 1)
- Higher frequencies end at pixel 573 (right side of Wall 3)
- Linear or logarithmic frequency scaling (TBD during implementation based on aesthetic results)

### Color Channel Decay System

Each pixel maintains **two properties** in HSV color space:
1. **Hue**: Rotates from blue (0.67) → cyan (0.5) → green (0.33) → yellow (0.17) → red (0.0) over time
2. **Value (Brightness)**: Starts at maximum (1.0), gradually fades to dark (0.0)
3. **Saturation**: Remains at maximum (1.0) throughout for vibrant colors

**Decay Timeline** (5 seconds total, 60 FPS = 300 frames):

| Time | Hue | Hue Color | Value | Visual Result |
|------|-----|-----------|-------|---------------|
| 0.0s | 0.67 | Pure Blue | 1.0 | Bright Blue |
| 1.25s | 0.5 | Cyan | 0.9 | Bright Cyan |
| 2.5s | 0.33 | Green | 0.7 | Bright Green |
| 3.75s | 0.17 | Yellow/Orange | 0.5 | Medium Orange |
| 5.0s | 0.0 | Red | 0.3 | Dim Red |
| 6.0s | 0.0 | Red | 0.0 | Off |

**Decay Functions** (approximate - adjust during implementation):
- **Hue rotation**: Linear progression from 0.67 (blue) to 0.0 (red) over DECAY_TIME
- **Value decay**: Exponential decay with slight delay, maintaining brightness early then fading

### Color Accumulation Behavior

**HSV-Based Approach** (SELECTED):

When a frequency is detected at a pixel:
1. **Reset to Blue**: Set hue = 0.67 (blue), value = 1.0 (full brightness)
2. **Accumulation Effect**: Frequently-retriggered pixels stay bright blue, while infrequent triggers show full color rotation

**Comparison of RGB Options** (for reference):

**Option A: Additive RGB Accumulation**
```
Current state: R=0.5, G=0.3, B=0.2
New trigger adds: R=0.0, G=0.0, B=1.0
Result: R=0.5, G=0.3, B=1.2 (OVERSATURATED - clips to 1.0)
```
- Problem: Values can exceed 1.0, causing clipping/saturation
- Result: Loss of color information, everything becomes white quickly

**Option B: Reset Blue, Preserve Others (RGB approach)**
```
Current state: R=0.5, G=0.3, B=0.2
New trigger adds: R=0.0, G=0.0, B=1.0
Result: R=0.5, G=0.3, B=1.0 (blue resets to max)
```
- Behavior: Blue channel resets to 1.0, Red and Green maintain current values
- Result: Preserves decay state of other channels while showing fresh trigger
- Frequently-triggered pixels: Blue stays at 1.0, other channels rise → white

**Why HSV is Better for This Pattern**:
- Natural color rotation through spectrum (blue → cyan → green → yellow → red)
- Single hue parameter instead of juggling 3 RGB channels
- Brightness (value) independent from color (hue)
- No oversaturation issues with additive mixing
- Simpler mental model: "reset to blue" = just set hue to 0.67
- Constant high saturation keeps colors vibrant throughout decay

**Implementation with HSV**:
```
When frequency triggers at pixel i:
  pixelHue[i] = 0.67        // Reset to blue
  pixelValue[i] = 1.0        // Reset to full brightness
  pixelSaturation[i] = 1.0   // Keep saturation high (can be constant)
  pixelDecayAge[i] = 0       // Reset decay timer
```

### Automatic Gain Control (AGC)

Use PI (Proportional-Integral) controller similar to `audio-lights.js` to normalize audio input levels.

**Purpose**: Ensure consistent brightness across different audio sources (quiet speech vs. loud music)

**Parameters** (starting values, tune during testing):
- `kp` (proportional gain): 0.05
- `ki` (integral gain): 0.35
- Target brightness: 0.5 (middle of 0.0 to 1.0 range)
- Sensitivity range: 0.5 to 2048

**Feedback Signal**: Average brightness across all active pixels

## Pixelblaze Language Constraints

**Must Follow These Rules**:
- Use `var` only (no `const`, no `let`)
- No objects or classes (use arrays instead)
- No closures or arrow functions
- No `switch`/`case` statements (use `if`/`else if`)
- All numbers are 16.16 fixed-point (-32,768 to +32,768)
- Arrays created with `array(size)`

**Available Features**:
- `export var` for UI controls and monitoring
- `beforeRender(delta)` for per-frame animation logic
- `render(index)` for per-pixel color setting
- Math functions: `pow()`, `sqrt()`, `sin()`, `cos()`, `floor()`, `ceil()`, `round()`, etc.
- Array methods: `array.forEach()`, `array.sum()`, `array.mutate()`
- Sensor board variables: `frequencyData`, `maxFrequencyMagnitude`, `maxFrequency`

## Program Structure

### Global Variables

```javascript
// Configuration
var DECAY_TIME = 5000  // Total decay time in milliseconds
var NUM_FREQ_BINS = 32  // Pixelblaze frequencyData array size
var SPEECH_MIN_FREQ = 200  // Hz - lower bound of speech
var SPEECH_MAX_FREQ = 8000  // Hz - upper bound of speech

// HSV color arrays (one per pixel)
var pixelHues = array(pixelCount)        // 0.0 (red) to 1.0 (red), 0.67 = blue
var pixelValues = array(pixelCount)      // 0.0 (dark) to 1.0 (bright)
var pixelDecayAge = array(pixelCount)    // Time in ms since last trigger

// Saturation is constant at 1.0 for all pixels (vibrant colors)
var SATURATION = 1.0

// Audio processing
export var frequencyData
export var maxFrequencyMagnitude
export var maxFrequency
export var sensitivity
var pic  // PI controller array

// Timing
var t1  // Time variable for animation
```

### UI Controls (Export Functions)

```javascript
export function sliderDecayTime(v)
// Range: 2-10 seconds
// Adjusts how long colors persist after trigger

export function sliderSensitivity(v)
// Range: 0.1-2.0
// Manual sensitivity adjustment (multiplies AGC output)

export function toggleSimulateAudio(bool)
// Enable/disable audio simulation when no sensor board connected

export function showNumberAvgBrightness()
// Display: Current average brightness (Value channel, AGC feedback)

export function gaugeBluePixels()
// Display: Percentage of pixels currently showing blue (hue > 0.6)

export function showNumberSensitivity()
// Display: Current AGC sensitivity value

export function showNumberAvgHue()
// Display: Average hue across all active pixels (for debugging)
```

### beforeRender(delta) Function

Called once per frame, handles:

1. **Audio Input Processing**
   - Check if sensor board connected (fallback to simulation)
   - Get `frequencyData` array (32 bins)
   
2. **AGC Calculation**
   - Calculate average brightness across all pixels (using pixelValues array)
   - Feed to PI controller (target = 0.5)
   - Update `sensitivity` value

3. **Frequency-to-Pixel Mapping**
   - For each frequency bin (0-31):
     - Calculate which pixel(s) correspond to that frequency
     - If bin magnitude exceeds threshold:
       - Reset pixel hue to 0.67 (blue)
       - Reset pixel value to 1.0 (full brightness)
       - Reset decay age to 0

4. **Color Decay Updates**
   - For all pixels, update based on decay age:
     - Increment `pixelDecayAge[i]` by delta
     - **Hue rotation**: Linear from 0.67 (blue) → 0.0 (red) over DECAY_TIME
     - **Value decay**: Exponential fade maintaining brightness early, then fading
   - Use delta timing for frame-rate independence

### render(index) Function

Called for each pixel, handles:

1. **Retrieve HSV Values**
   - Get `pixelHues[index]` (0.0 to 1.0, where 0.67 = blue, 0.0 = red)
   - Get `pixelValues[index]` (0.0 to 1.0, brightness)
   - Saturation is constant at 1.0

2. **Output Color**
   - Call `hsv(pixelHues[index], SATURATION, pixelValues[index])`
   - This is native to Pixelblaze, no conversion needed!

## Decay Function Mathematics

**Goal**: Create smooth color transitions over 5 seconds using HSV color rotation

### Hue Rotation
Linear progression from blue (0.67) through the spectrum to red (0.0):
```
hue(t) = 0.67 * (1 - t / DECAY_TIME)
where t = time since last trigger (in ms)

At t=0ms: hue=0.67 (blue)
At t=1250ms: hue=0.5025 (cyan)
At t=2500ms: hue=0.335 (green)
At t=3750ms: hue=0.1675 (yellow/orange)
At t=5000ms: hue=0.0 (red)
```

Alternative non-linear rotation for more time in certain colors:
```
// Spend more time in blue/cyan range, faster through green/yellow
hue(t) = 0.67 * pow(1 - t / DECAY_TIME, 0.8)
```

### Value (Brightness) Decay
Exponential decay with delayed onset - stays bright initially, then fades:
```
value(t) = pow(1 - t / (DECAY_TIME * 1.2), 2)
where t = time since last trigger (in ms)

At t=0ms: value=1.0 (full brightness)
At t=2500ms: value≈0.65 (still quite bright)
At t=5000ms: value≈0.31 (dimmed)
At t=6000ms: value≈0.0 (off)
```

Alternative decay curves:
```
// Slower initial decay, faster at end
value(t) = exp(-2.0 * t / DECAY_TIME)

// Linear decay (simpler, less natural)
value(t) = max(0, 1 - t / DECAY_TIME)
```

### Saturation
Remains constant at 1.0 for maximum color vibrancy throughout the decay cycle.

**Note**: These formulas are starting points. Adjust coefficients during implementation for desired visual effect. The key insight with HSV is that hue rotation gives you the color progression naturally, while value controls fading independently.

## Frequency-to-Pixel Mapping Algorithm

### Approach: Linear Mapping with Speech Focus

Since Pixelblaze provides 32 frequency bins covering ~0-10,000 Hz, and we want to focus on speech (200-8,000 Hz):

1. **Bin Selection**: Use bins approximately covering 200-8,000 Hz (estimate bins 2-30)
2. **Pixel Distribution**: Map those ~28 bins across 574 pixels
3. **Interpolation**: Each bin affects multiple pixels with smooth falloff

**Pseudocode**:
```
For each frequency bin (i = 0 to 31):
  binFreq = estimate frequency for bin i
  
  if binFreq < SPEECH_MIN_FREQ or binFreq > SPEECH_MAX_FREQ:
    continue  // Skip non-speech frequencies
  
  // Map frequency to pixel position (linear scale)
  pixelPos = (binFreq - SPEECH_MIN_FREQ) / (SPEECH_MAX_FREQ - SPEECH_MIN_FREQ) * pixelCount
  
  // Get bin magnitude
  magnitude = frequencyData[i] * sensitivity
  
  if magnitude > threshold:
    // Trigger blue for this pixel and neighbors (smooth spreading)
    pixelStart = max(0, floor(pixelPos - 2))
    pixelEnd = min(pixelCount - 1, ceil(pixelPos + 2))
    
    for p = pixelStart to pixelEnd:
      distance = abs(p - pixelPos)
      intensity = pow(0.5, distance)  // Exponential falloff
      
      if magnitude * intensity > threshold:
        // Reset to blue
        pixelHues[p] = 0.67         // Blue hue
        pixelValues[p] = 1.0         // Full brightness
        pixelDecayAge[p] = 0         // Reset decay timer
```

**Alternative**: Logarithmic frequency mapping (more pixels for lower frequencies) if linear looks unbalanced.

## Testing & Tuning Parameters

### Initial Values
- Decay time: 5000ms
- AGC target: 0.5
- Trigger threshold: 0.15 (after AGC adjustment)
- Decay coefficients: As specified above

### Tuning Checklist
1. **Decay timing**: Should colors transition smoothly and not feel too fast/slow
2. **Brightness balance**: White pixels should be readable but not overpowering
3. **Frequency spread**: Verify speech frequencies are well-represented
4. **AGC responsiveness**: Should adapt to volume changes within 1-2 seconds
5. **Color saturation**: Ensure frequently-triggered pixels reach white, not just bright blue

### Debug UI Controls
Add these to aid development:
- `showNumberMaxFreq()`: Display current dominant frequency
- `showNumberAvgDecayTime()`: Actual measured decay time
- `toggleFreezeDecay(bool)`: Pause decay to inspect current state

## Implementation Notes

### Performance Considerations
- 574 pixels × 3 properties (hue, value, decay age) = 1,722 array values to update per frame
- Target 60 FPS = 16.6ms per frame budget
- Keep `beforeRender()` efficient: minimize array iterations
- HSV is native to Pixelblaze, so no conversion overhead in `render()`

### Edge Cases
- **No audio input**: All pixels fade to black naturally
- **Sensor board disconnected**: Use simulated audio (sine wave sweep)
- **Oversaturation**: Clamp all color channels to [0.0, 1.0]
- **First trigger**: Handle uninitialized state (all channels start at 0)

### Pixelblaze Quirks
- Fixed-point math may cause precision issues in decay calculations
- Array operations are relatively slow; avoid unnecessary copies
- `delta` timing varies based on frame rate; always use for animations

## Success Criteria

The pattern successfully achieves these goals:

1. **Visual Clarity**: Easy to identify which frequencies are currently active
2. **Persistence**: Continuous sounds appear white, brief sounds show color trails
3. **Responsiveness**: Reacts to audio within 1 frame (~16ms)
4. **Aesthetic Appeal**: Smooth color transitions, no jarring flashes
5. **Educational Value**: Intuitively demonstrates frequency content of sound
6. **Performance**: Maintains 60 FPS with all 574 pixels active

## Future Enhancements (Out of Scope)

- Per-wall frequency ranges (different speech elements per wall)
- Intensity-based color saturation (louder = brighter)
- Temporal patterns (rhythm visualization)
- Integration with pixel mapper for 2D coordinate effects

## Files to Reference

- `pixelblaze-documentation.md`: Full API reference
- `audio-lights.js`: Working example of audio processing and PI controller
- `pixel-mapper.js`: 2D coordinate mapping (if needed)
- `cochlear-first-try.js`: Initial attempt (reference for what to improve)

## Development Workflow

1. **Read this design document completely**
2. **Review Pixelblaze language constraints** in documentation
3. **Start with basic structure**: Global vars, beforeRender, render
4. **Implement decay functions** first (test with static triggers)
5. **Add audio input processing** and frequency mapping
6. **Integrate AGC system** from audio-lights.js
7. **Add UI controls** for tuning
8. **Test with real audio** and iterate on parameters
9. **Document final values** and any deviations from this design

---

## Appendix: Color Theory

**Why Blue → Red progression?**
- Matches intuitive "heat" visualization (cold blue → hot red)
- High contrast for visibility across spectrum
- Blue triggers are visually distinct from red trails
- Color wheel rotation creates natural, smooth transitions

**Why HSV over RGB for this pattern?**
- **Natural color rotation**: Single hue parameter rotates through spectrum (blue → cyan → green → yellow → red)
- **Independent brightness control**: Value fades without affecting color identity
- **No channel juggling**: Don't need to coordinate 3 RGB channels to create color progression
- **Native to Pixelblaze**: `hsv()` function is built-in, no conversion needed
- **Simpler mental model**: "Reset to blue" = set hue to 0.67, done
- **Constant saturation**: Keep colors vibrant throughout decay (RGB mixing often desaturates)
- **Better for future enhancements**: Easy to add hue offsets, color temperature effects, etc.

**HSV Color Wheel Reference** (for Pixelblaze):
- 0.0 or 1.0 = Red
- 0.17 = Orange/Yellow
- 0.33 = Green
- 0.5 = Cyan
- 0.67 = Blue
- 0.83 = Magenta

**RGB Comparison**:
Creating blue → red in RGB requires coordinating three channels:
- Blue: 1.0 → 0.7 → 0.0 (fast decay)
- Green: 0.0 → 0.7 → 1.0 → 0.5 → 0.0 (bell curve)
- Red: 0.0 → 0.0 → 0.5 → 0.8 → 0.5 (slow rise and fall)

Creating blue → red in HSV requires one parameter:
- Hue: 0.67 → 0.5 → 0.33 → 0.17 → 0.0 (linear rotation)

**Visual Effect**:
- Frequently-triggered pixels: Stay bright blue (high value, hue stuck at 0.67)
- Occasionally-triggered pixels: Show full spectrum trail as they decay
- Silent pixels: Fade to black (value → 0.0)

## Appendix: Cochlear Implant Reference

Real cochlear implants:
- Use 12-22 electrode channels
- Cover ~200-8,000 Hz (speech range)
- Process temporal envelope (amplitude over time)
- Update at ~18,000 Hz pulse rate

This pattern simplifies:
- 574 "channels" (much finer resolution)
- Visual instead of electrical stimulation
- Persistence of vision instead of neural integration
- Focus on frequency content over temporal fine structure

**Educational note**: This is an artistic interpretation, not a medical simulation.
