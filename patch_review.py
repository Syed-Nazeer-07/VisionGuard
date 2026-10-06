import re

with open('apps/web/src/pages/VideoReview.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

replacement = """        const videoRatio = video.videoWidth / video.videoHeight;
        const canvasRatio = canvas.width / canvas.height;

        let renderWidth = canvas.width;
        let renderHeight = canvas.height;
        let offsetX = 0;
        let offsetY = 0;

        if (videoRatio > canvasRatio) {
          renderHeight = canvas.width / videoRatio;
          offsetY = (canvas.height - renderHeight) / 2;
        } else {
          renderWidth = canvas.height * videoRatio;
          offsetX = (canvas.width - renderWidth) / 2;
        }

        const sx = renderWidth / video.videoWidth;
        const sy = renderHeight / video.videoHeight;"""

# We replace:
# const sx = canvas.width / video.videoWidth;
# const sy = canvas.height / video.videoHeight;
content = re.sub(
    r'\s*const sx = canvas\.width / video\.videoWidth;\s*const sy = canvas\.height / video\.videoHeight;',
    '\n' + replacement,
    content
)

# And replace:
# const cx = (p.bbox[0] + p.bbox[2] / 2) * sx;
# const cy = (p.bbox[1] + p.bbox[3]) * sy;
content = re.sub(
    r'const cx = \(p\.bbox\[0\] \+ p\.bbox\[2\] / 2\) \* sx;',
    'const cx = (p.bbox[0] + p.bbox[2] / 2) * sx + offsetX;',
    content
)
content = re.sub(
    r'const cy = \(p\.bbox\[1\] \+ p\.bbox\[3\]\) \* sy;',
    'const cy = (p.bbox[1] + p.bbox[3]) * sy + offsetY;',
    content
)

# And replace:
# const x = bx * sx, y = by * sy, w = bw * sx, h = bh * sy;
content = re.sub(
    r'const x = bx \* sx, y = by \* sy, w = bw \* sx, h = bh \* sy;',
    'const x = bx * sx + offsetX, y = by * sy + offsetY, w = bw * sx, h = bh * sy;',
    content
)

with open('apps/web/src/pages/VideoReview.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
