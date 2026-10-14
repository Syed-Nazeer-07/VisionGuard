import re

with open('apps/web/src/pages/Analyze.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update container className
old_container_class = r"className={`relative bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-\[440px\] border border-slate-800 shadow-xl \$\{isFullscreen \? 'w-full h-screen' : 'max-h-\[68vh\]'\}`}"
new_container_class = "className={`bg-slate-950 flex items-center justify-center overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[100] w-full h-full' : 'relative rounded-2xl min-h-[440px] max-h-[68vh] border border-slate-800 shadow-xl'}`}"
content = re.sub(old_container_class, new_container_class, content)

# 2. Wrap video and canvas
# We need to find the video and canvas elements and wrap them.
video_canvas_regex = r'(<video\s+id="analyze-video".*?/>\s*<canvas\s+ref=\{canvasRef\}\s+className="absolute pointer-events-none z-20"\s+style=\{\{[^}]+\}\}\s+/>)'

wrapper_start = '<div className={`relative flex items-center justify-center h-full w-full ${showVideo ? \'\' : \'hidden\'}`}>\n              '
wrapper_end = '\n            </div>'

def replace_vc(match):
    vc_block = match.group(1)
    # Remove dynamic styles from canvas
    vc_block = re.sub(r'style=\{\{[\s\S]*?\}\}', '', vc_block)
    # Update canvas className
    vc_block = vc_block.replace('className="absolute pointer-events-none z-20"', 'className="absolute inset-0 w-full h-full pointer-events-none z-20"')
    # Replace video className
    vc_block = re.sub(
        r'className=\{`max-w-full max-h-full w-auto h-auto z-10 \$\{showVideo \? \'\' : \'hidden\'\}`\}',
        'className="max-w-full max-h-full object-contain z-10"',
        vc_block
    )
    return wrapper_start + vc_block + wrapper_end

content = re.sub(video_canvas_regex, replace_vc, content, flags=re.DOTALL)

# 3. Fix handleResult canvas syncing
old_sync = """            if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
              canvas.width = video.clientWidth;
              canvas.height = video.clientHeight;
            }
            if (canvas.style.width !== `${video.clientWidth}px`) canvas.style.width = `${video.clientWidth}px`;
            if (canvas.style.height !== `${video.clientHeight}px`) canvas.style.height = `${video.clientHeight}px`;
            if (canvas.style.left !== `${video.offsetLeft}px`) canvas.style.left = `${video.offsetLeft}px`;
            if (canvas.style.top !== `${video.offsetTop}px`) canvas.style.top = `${video.offsetTop}px`;"""

new_sync = """            if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
              canvas.width = video.clientWidth;
              canvas.height = video.clientHeight;
            }"""

content = content.replace(old_sync, new_sync)

with open('apps/web/src/pages/Analyze.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
