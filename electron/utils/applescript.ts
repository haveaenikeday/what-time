import { execFile } from 'child_process'

/**
 * Execute an AppleScript string via osascript.
 * Returns stdout on success, throws on failure.
 */
export function runAppleScript(script: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'osascript',
      ['-e', script],
      { timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          // Check for accessibility permission error
          const msg = stderr || error.message
          if (msg.includes('not allowed assistive access') || msg.includes('1002')) {
            reject(
              new Error(
                'Accessibility permission not granted. Go to System Settings > Privacy & Security > Accessibility and add this app.'
              )
            )
          } else {
            reject(new Error(msg))
          }
        } else {
          resolve(stdout.trim())
        }
      }
    )

    // Safety timeout kill
    setTimeout(() => {
      proc.kill()
    }, timeoutMs + 1000)
  })
}

/**
 * Run a shell command (like `open` for URL schemes).
 */
export function runCommand(command: string, args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}
