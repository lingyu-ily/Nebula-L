import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const shortCommit = __NEBULA_BUILD_COMMIT__ === 'dev'
    ? __NEBULA_BUILD_COMMIT__
    : __NEBULA_BUILD_COMMIT__.slice(0, 7)

export function BuildVersion(): ReactNode {
    const { t } = useTranslation()
    const accessibleLabel = t('buildVersionLabel', {
        version: __NEBULA_VERSION__,
        commit: __NEBULA_BUILD_COMMIT__
    })

    return <span className="build-version" title={accessibleLabel} aria-label={accessibleLabel}>
        v{__NEBULA_VERSION__} · {shortCommit}
    </span>
}
