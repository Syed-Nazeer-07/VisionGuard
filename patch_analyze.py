import re

with open('apps/web/src/pages/Analyze.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add Maximize2, Minimize2 imports
if 'Maximize2' not in content:
    content = re.sub(
        r"import \{(.*?)\} from 'lucide-react';",
        r"import {\1, Maximize2, Minimize2} from 'lucide-react';",
        content,
        flags=re.DOTALL
    )

# 2. Add containerRef and isFullscreen state
if 'const containerRef = useRef<HTMLDivElement>(null);' not in content:
    content = re.sub(
        r"const videoRef = useRef<HTMLVideoElement>\(null\);",
        "const containerRef = useRef<HTMLDivElement>(null);\n  const videoRef = useRef<HTMLVideoElement>(null);\n  const [isFullscreen, setIsFullscreen] = useState(false);",
        content
    )

# 3. Add fullscreenchange listener
if 'handleFullscreenChange' not in content:
    content = re.sub(
        r"useEffect\(\(\) => \{\n\s+return \(\) => \{\n\s+if \(workerRef\.current\) \{",
        "useEffect(() => {\n    const handleFullscreenChange = () => {\n      setIsFullscreen(document.fullscreenElement === containerRef.current);\n    };\n    document.addEventListener('fullscreenchange', handleFullscreenChange);\n    return () => {\n      document.removeEventListener('fullscreenchange', handleFullscreenChange);\n      if (workerRef.current) {",
        content
    )

# 4. Add toggleFullscreen function
if 'toggleFullscreen' not in content:
    content = re.sub(
        r"const clearActiveVideo = \(\) => \{",
        "const toggleFullscreen = () => {\n    if (!document.fullscreenElement) {\n      containerRef.current?.requestFullscreen().catch(err => console.error(err));\n    } else {\n      document.exitFullscreen();\n    }\n  };\n\n  const clearActiveVideo = () => {",
        content
    )

# 5. Modify video element to disable native fullscreen and add our fullscreen button
content = re.sub(
    r'<div\s+className="relative bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-\[440px\] max-h-\[68vh\] border border-slate-800\s*shadow-xl"',
    '<div\n              ref={containerRef}\n              className={`relative bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-[440px] border border-slate-800 shadow-xl ${isFullscreen ? \'w-full h-screen\' : \'max-h-[68vh]\'}`}',
    content,
    flags=re.DOTALL
)

# 6. Add controlsList="nofullscreen" to video
content = content.replace(
    'controls\n                playsInline',
    'controls\n                controlsList="nofullscreen"\n                playsInline'
)

# 7. Add fullscreen button inside the container, right after the canvas
button_code = """
              <button
                type="button"
                onClick={toggleFullscreen}
                className="absolute top-4 right-4 z-40 p-2 bg-black/50 hover:bg-black/70 text-white rounded-lg backdrop-blur-sm transition-colors"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
              </button>
"""

if 'toggleFullscreen' not in content or 'Minimize2 className' not in content:
    content = re.sub(
        r'(<canvas\s+ref=\{canvasRef\}.*?/>)',
        r'\1' + button_code,
        content,
        flags=re.DOTALL
    )
    
# 8. Modify video className to allow fullscreen scaling
content = re.sub(
    r'className={`max-h-\[68vh\] w-auto z-10 \$\{showVideo \? \'\' : \'hidden\'\}`}',
    r'className={`max-w-full max-h-full w-auto h-auto z-10 ${showVideo ? \'\' : \'hidden\'}`}',
    content
)

with open('apps/web/src/pages/Analyze.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
