/** Linux parent-death guard closes the race between spawning Chromium and tracking it. */
export function chromiumGuard(parent: number, executable = '/usr/bin/chromium'): string {
  return `#!/usr/bin/python3
import ctypes, os, signal, sys
parent = ${parent}
if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL) != 0 or os.getppid() != parent:
    sys.exit(1)
os.execv(${JSON.stringify(executable)}, [${JSON.stringify(executable)}, *sys.argv[1:]])
`;
}
