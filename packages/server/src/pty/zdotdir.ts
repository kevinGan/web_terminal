import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Set up an alternate ZDOTDIR with a wrapper .zshrc that:
 *   1. sources the user's real rc files,
 *   2. installs precmd hooks emitting OSC 1337 CurrentDir + OSC 7 file://,
 *   3. tolerates missing files and doesn't override the user's environment.
 *
 * Returns the directory path. Caller passes it as ZDOTDIR in the spawn env.
 */
export function ensureZDotDir(dataDir: string): string {
  const dir = join(dataDir, 'zsh-init');
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const zshenv = join(dir, '.zshenv');
  if (!existsSync(zshenv)) {
    writeFileSync(zshenv, ZSHENV_WRAPPER, { encoding: 'utf8', mode: 0o644 });
  }
  const zshrc = join(dir, '.zshrc');
  writeFileSync(zshrc, ZSHRC_WRAPPER, { encoding: 'utf8', mode: 0o644 });
  const zprofile = join(dir, '.zprofile');
  writeFileSync(zprofile, ZPROFILE_WRAPPER, { encoding: 'utf8', mode: 0o644 });
  const zlogin = join(dir, '.zlogin');
  writeFileSync(zlogin, ZLOGIN_WRAPPER, { encoding: 'utf8', mode: 0o644 });
  return dir;
}

const ZSHENV_WRAPPER = `# Web Terminal wrapper .zshenv — sources user's real .zshenv if present.
__WT_USER_HOME="\${WEBTERM_USER_HOME:-$HOME}"
[ -f "$__WT_USER_HOME/.zshenv" ] && . "$__WT_USER_HOME/.zshenv"
unset __WT_USER_HOME
`;

const ZPROFILE_WRAPPER = `# Web Terminal wrapper .zprofile
__WT_USER_HOME="\${WEBTERM_USER_HOME:-$HOME}"
__WT_USER_ZDOTDIR="\${WEBTERM_USER_ZDOTDIR:-$__WT_USER_HOME}"
[ -f "$__WT_USER_ZDOTDIR/.zprofile" ] && . "$__WT_USER_ZDOTDIR/.zprofile"
unset __WT_USER_HOME __WT_USER_ZDOTDIR
`;

const ZLOGIN_WRAPPER = `# Web Terminal wrapper .zlogin
__WT_USER_HOME="\${WEBTERM_USER_HOME:-$HOME}"
__WT_USER_ZDOTDIR="\${WEBTERM_USER_ZDOTDIR:-$__WT_USER_HOME}"
[ -f "$__WT_USER_ZDOTDIR/.zlogin" ] && . "$__WT_USER_ZDOTDIR/.zlogin"
unset __WT_USER_HOME __WT_USER_ZDOTDIR
`;

const ZSHRC_WRAPPER = `# Web Terminal wrapper .zshrc — sources user's .zshrc, then installs cwd hook.
__WT_USER_HOME="\${WEBTERM_USER_HOME:-$HOME}"
__WT_USER_ZDOTDIR="\${WEBTERM_USER_ZDOTDIR:-$__WT_USER_HOME}"

# Restore user-visible ZDOTDIR before sourcing (some configs read $ZDOTDIR).
__WT_OUR_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$__WT_USER_ZDOTDIR"

if [ -f "$__WT_USER_ZDOTDIR/.zshrc" ]; then
  . "$__WT_USER_ZDOTDIR/.zshrc"
fi

# Restore (some prompt frameworks rely on ZDOTDIR being a real path)
ZDOTDIR="$__WT_USER_ZDOTDIR"
unset __WT_OUR_ZDOTDIR

# Web Terminal cwd hook: emit OSC 1337 CurrentDir on each prompt
__webterm_emit_cwd() { print -n $'\\e]1337;CurrentDir='"$PWD"$'\\a' }
typeset -ga precmd_functions 2>/dev/null
if [[ -z "\${precmd_functions[(r)__webterm_emit_cwd]}" ]]; then
  precmd_functions+=(__webterm_emit_cwd)
fi
__webterm_emit_cwd

unset __WT_USER_HOME __WT_USER_ZDOTDIR
`;
