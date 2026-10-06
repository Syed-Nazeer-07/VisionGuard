import re

with open('apps/web/src/pages/Analyze.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

replacement = """          if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
            canvas.width = video.clientWidth;
            canvas.height = video.clientHeight;
          }
          if (canvas.style.width !== `${video.clientWidth}px`) canvas.style.width = `${video.clientWidth}px`;
          if (canvas.style.height !== `${video.clientHeight}px`) canvas.style.height = `${video.clientHeight}px`;
          if (canvas.style.left !== `${video.offsetLeft}px`) canvas.style.left = `${video.offsetLeft}px`;
          if (canvas.style.top !== `${video.offsetTop}px`) canvas.style.top = `${video.offsetTop}px`;
          drawBoundingBoxes(ctx, msg.tracks, canvas.width, canvas.height, video.videoWidth, video.videoHeight);"""

content = re.sub(
    r'\s*if\s*\(canvas\.width\s*!==\s*video\.clientWidth\s*\|\|\s*canvas\.height\s*!==\s*video\.clientHeight\)\s*\{\s*canvas\.width\s*=\s*video\.clientWidth;\s*canvas\.height\s*=\s*video\.clientHeight;\s*\}\s*drawBoundingBoxes\(ctx,\s*msg\.tracks,\s*canvas\.width,\s*canvas\.height,\s*video\.videoWidth,\s*video\.videoHeight\);',
    '\n' + replacement,
    content
)

with open('apps/web/src/pages/Analyze.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
