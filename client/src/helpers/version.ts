/**
 * Checks if versions are equal.
 * Please note, that this method strips the "v" prefix.
 *
 * @param left {string} - left version
 * @param right {string} - right version
 * @return {boolean} true if versions are equal
 */
export const areEqualVersions = (left: any, right: any) => {
    if (!left || !right) {
        return false;
    }

    const leftVersion = left.replace(/^v/, '');
    const rightVersion = right.replace(/^v/, '');
    return leftVersion === rightVersion;
};

const parseCoreVersion = (version: string) => {
    const clean = version.replace(/^v/, '');
    const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
        return null;
    }

    return [Number(match[1]), Number(match[2]), Number(match[3])];
};

// Returns true when current version is the same as latest version or newer.
// It supports custom/fork suffixes like "-dev", "-g<sha>", "+metadata".
export const isVersionAtLeast = (current: any, latest: any) => {
    if (!current || !latest) {
        return false;
    }

    const currentCore = parseCoreVersion(String(current));
    const latestCore = parseCoreVersion(String(latest));

    if (currentCore && latestCore) {
        for (let i = 0; i < 3; i += 1) {
            if (currentCore[i] > latestCore[i]) {
                return true;
            }
            if (currentCore[i] < latestCore[i]) {
                return false;
            }
        }

        return true;
    }

    return areEqualVersions(current, latest);
};
