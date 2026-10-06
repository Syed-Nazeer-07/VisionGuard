import re

with open('apps/web/src/pages/Analyze.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Insert useEffect for fullscreen
fullscreen_effect = """
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);
"""

if 'handleFullscreenChange' not in content:
    content = content.replace(
        'const [isFullscreen, setIsFullscreen] = useState(false);',
        'const [isFullscreen, setIsFullscreen] = useState(false);\n' + fullscreen_effect
    )

with open('apps/web/src/pages/Analyze.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
