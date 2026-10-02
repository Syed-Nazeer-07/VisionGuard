

export function Landing() {
  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">
      <header className="px-6 py-4 flex items-center justify-between border-b border-gray-800">
        <div className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
          VisionGuard AI
        </div>
        <nav className="flex gap-4">
          <a href="/login" className="px-4 py-2 hover:bg-gray-800 rounded transition">Login</a>
          <a href="/app" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded transition font-medium">Dashboard</a>
        </nav>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-5xl md:text-7xl font-bold mb-6">Traffic Monitoring, Reimagined.</h1>
        <p className="text-xl text-gray-400 max-w-2xl mb-10">
          Browser-first AI for intelligent traffic analysis and violation detection. Zero GPU servers required.
        </p>
        <a href="/app" className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-lg rounded-full transition font-semibold">
          Enter Control Room
        </a>
      </main>
    </div>
  )
}
