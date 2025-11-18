/* Pixel Mapper
 * Maps a linear array of pixels to a 2D coordinate system
 * */

function (pixelCount) {
  var map = []
  for (i = 0; i < pixelCount; i++) {
    // (0, 0)
    // (0, 190)
    // (196, 190)
    // (196, 0)
    if (i <= 187) {
      x = 0
      y = i
    }
    else if (i <= 385) {
      // x is at 0 and needs to increment with an offset to 198
      x = i - 188
      y = 188
    }
    else {
      x = 198
      y = pixelCount - i
    }
    map.push([x, y])
  }
  return map
}
