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
