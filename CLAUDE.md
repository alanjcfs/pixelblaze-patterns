# Pixelblaze LED Pattern Development

This directory contains LED patterns for Pixelblaze, a programmable LED controller.

## Project Overview

- **LED Strip**: 574 pixels total arranged on crown molding
- **Layout**: Three walls with 188, 198, and 188 pixels respectively
- **Device**: Pixelblaze controller with optional sensor expansion board

## Important Files

### `audio-lights.js`
Sound-reactive pattern that creates colorful rays traveling along the LED strip. Features:
- Colors based on audio frequency (low = red, high = purple)
- Brightness based on volume
- Automatic gain control using PI controller
- Lights flow from wall corners to centers
- Supports sensor board or simulated audio data

### `cochlear-implant.js`
Audio frequency visualization simulating a 22-electrode cochlear implant. The 574-pixel strip is divided into 22 segments (~26 pixels each), with each segment representing one frequency band. Features:

**22-Electrode Segmented Architecture**:
- 22 logarithmically-spaced frequency bands (200-8000 Hz speech range)
- Each segment = ~26 pixels sharing synchronized color state
- Center pixel represents the frequency, surrounding pixels represent amplitude

**Amplitude-Based Spatial Growth**:
- **Quiet sounds**: Only center pixel lights up
- **Moderate sounds**: Center + neighbor pixels
- **Loud sounds**: Entire segment lights up
- Amplitude controls segment SIZE, not just brightness

**Synchronized Segment Decay**:
- All pixels in a segment decay together (same color/brightness)
- **Hue**: Blue (0.67) → Cyan → Green → Yellow → Red (0.0) over 5 seconds (linear)
- **Value**: Full brightness → dark with exponential fade (6 seconds total)
- **Saturation**: Desaturates by 0.1 per trigger (frequent = white, infrequent = vibrant)
- **Amplitude**: Segment shrinks quickly (fully shrunk at 30% of decay time)

**Visual Result**:
- Constant/frequent sounds = white segments (desaturated)
- Intermittent sounds = colored trails (full hue rotation visible)
- Quiet sounds = small segments, loud sounds = large segments

**Technical Details**:
- Logarithmic frequency band calculation (like real cochlear implants)
- Per-segment state arrays (22 values each, not 574 per-pixel arrays)
- Fixed AGC feedback: Uses average brightness of recently-triggered segments (< 500ms)
- PI controller for automatic gain control
- User controls: decay time (2-10s), sensitivity (0.1x-2.0x), desaturation amount
- Audio simulation mode for testing (frequency sweep)

Full implementation details and design rationale in `cochlear-pattern-design.md`.

### `pixelblaze-documentation.md`
Complete API reference for the Pixelblaze programming language including:
- Language features and limitations
- UI controls (sliders, toggles, color pickers, etc.)
- Math, array, and waveform functions
- Pixel/color manipulation
- Sensor board integration

## Key Concepts

### Pixelblaze Language
- Based on JavaScript ES6 syntax with limitations
- **No support for**: `const`, `let`, objects, classes, closures, `switch`/`case`
- **Supported**: `var`, functions, arrays, basic control flow
- All numbers are 16.16 fixed-point (-32,768 to +32,768)

### Pattern Structure
- `beforeRender(delta)`: Called once per frame for animations
- `render(index)`: Called for each pixel to set its color
- `export` variables for UI controls and monitoring

### UI Controls
Export functions with special prefixes to create controls:
- `sliderName(v)`: Range slider (0.0 to 1.0)
- `toggleName(bool)`: Toggle switch
- `hsvPickerName(h,s,v)`: Color picker
- `showNumberName()`: Display value
- `gaugeName()`: Progress gauge

## LED Strip Configuration

```javascript
// Wall layout (defined in audio-lights.js)
Wall 1: pixels 0-187   (188 pixels) - center at 94
Wall 2: pixels 188-385 (198 pixels) - center at 287
Wall 3: pixels 386-573 (188 pixels) - center at 480
```

Each wall is split at its center, with lights flowing from both corners toward the middle.

## Development Notes

- Always use `var` for variables, never `const` or `let`
- Use backticks for inline code and triple backticks for code blocks in documentation
- Test patterns with simulated audio if no sensor board is connected
- The Pixelblaze compiler validates code in real-time
