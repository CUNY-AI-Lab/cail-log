const SECRET_SHAPED_VALUE_RE = /(?:^|[^a-z0-9])(?:sk-(?:cail|live|test|proj|ant)-|gh[opusr]_|github_pat_|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-|eyJ[a-zA-Z0-9_-]{8,}\.)/;
export function isSecretShaped(value) {
    return SECRET_SHAPED_VALUE_RE.test(value);
}
