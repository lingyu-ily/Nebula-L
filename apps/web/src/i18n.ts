import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

const en = {
    translation: {
        brand: 'Nebula Console',
        tagline: 'Controlled releases for every Helios distribution.',
        buildVersionLabel: 'Nebula version {{version}}, build {{commit}}',
        login: 'Sign in', username: 'Username', password: 'Password', logout: 'Sign out',
        projects: 'Distributions', users: 'Accounts', audit: 'Audit log',
        newProject: 'New distribution', name: 'Name', slug: 'Slug', description: 'Description', rss: 'RSS URL', create: 'Create', save: 'Save', cancel: 'Cancel',
        open: 'Open', active: 'Active', draft: 'Draft', revision: 'Revision', publish: 'Publish update', publishing: 'Publishing…',
        projectSettings: 'Distribution settings', servers: 'Servers', files: 'Files & modules', releases: 'Releases', jobs: 'Background jobs',
        launcherDistribution: 'Launcher distribution', launcherDistributionHint: 'Use this stable URL in the launcher. It automatically follows the active release.', launcherReady: 'Ready', launcherUnavailable: 'Stable file mismatch', launcherNotPublished: 'Not published', activeReleaseId: 'Active release ID', copyUrl: 'Copy URL', copied: 'Copied',
        newServer: 'Add server', editServer: 'Edit server', serverId: 'Server ID', minecraft: 'Minecraft', serverVersion: 'Configuration version', address: 'Address', loader: 'Loader', loaderVersion: 'Loader version', mainServer: 'Main server', autoconnect: 'Auto-connect', order: 'Order',
        uploadModule: 'Upload module', chooseServer: 'Choose server', chooseFile: 'Choose file', type: 'Type', destination: 'Destination path', required: 'Required', optionalOn: 'Optional, on by default', optionalOff: 'Optional, off by default', upload: 'Upload',
        curseForge: 'Import CurseForge pack', import: 'Import', waitingFile: 'Manual file required', delete: 'Delete', edit: 'Edit',
        noProjects: 'No distributions yet.', noServers: 'No servers yet.', noRecords: 'No records.',
        status: 'Status', attempts: 'Attempts', progress: 'Progress', error: 'Error', retry: 'Retry', rollback: 'Activate', retained: 'Retained', removed: 'Removed',
        newUser: 'New account', role: 'Role', admin: 'Admin', editor: 'Editor', auditor: 'Auditor', disable: 'Disable', enable: 'Enable', resetPassword: 'Reset password',
        forcedPassword: 'Change temporary password', currentPassword: 'Current password', newPassword: 'New password', changePassword: 'Change password', passwordTooShort: 'Password must contain at least 12 characters.',
        actor: 'Actor', action: 'Action', entity: 'Entity', time: 'Time', exportCsv: 'Export CSV', exportJson: 'Export JSON',
        publishHint: 'A snapshot of this revision will be generated, verified, then atomically activated.',
        confirmDelete: 'Delete this item?', confirmPublish: 'Publish this draft?', confirmRollback: 'Activate this retained release?',
        language: '中文', success: 'Completed', refresh: 'Refresh', projectSaved: 'Distribution saved.',
        loaderNone: 'No loader', bytes: 'bytes', manualUrl: 'Manual download',
        versionsLoading: 'Loading version suggestions…', versionsUnavailable: 'Suggestions unavailable. Enter a version manually.', versionsStale: 'Showing cached suggestions. Manual entry is available.', manualVersionHint: 'Choose a suggestion or enter a version manually.', noCompatibleVersions: 'No compatible versions found. You can still enter one manually.', selectMinecraftFirst: 'Choose or enter a Minecraft version first.',
        recommendedVersion: 'Recommended', latestVersion: 'Latest', stableVersion: 'Stable',
        discordClient: 'Discord client ID', discordSmallText: 'Discord small image text', discordSmallKey: 'Discord small image key',
        discordShort: 'Discord short ID', discordLargeText: 'Discord large image text', discordLargeKey: 'Discord large image key',
        serverIcon: 'Server icon', javaSupported: 'Supported Java range', javaSuggested: 'Suggested Java major', ramMinimum: 'Minimum RAM (MB)', ramRecommended: 'Recommended RAM (MB)', untrackedRules: 'Untracked rules', untrackedHint: 'One rule per line, for example files:config/**/*.yml',
        manage: 'Manage', overview: 'Overview', settings: 'Settings', serverNavigation: 'Server management', launcherPage: 'Launcher page',
        launcherPageHint: 'Per-server artwork, branding copy, and update feed published to Helios.', launcherBackground: 'Hero background', launcherLogo: 'Hero logo', launcherEyebrow: 'Logo eyebrow', launcherTitle: 'Hero title', launcherTagline: 'Hero description', launcherNewsRss: 'Server update RSS URL',
        launcherUsesDefault: 'Uses the Launcher default', launcherImageConfigured: 'Custom image selected', launcherImageMissing: 'The source image is missing. Re-upload it.', launcherClearImage: 'Clear image', launcherEmptyFallback: 'Empty fields inherit the distribution or Launcher default.', launcherImageTypeError: 'Choose a PNG, JPEG, or WebP image.', launcherFallbackEyebrow: 'MAPLECRAFT SERVER', launcherFallbackTagline: 'Server content will appear here.',
        folders: 'folders', publishBlocked: 'Publishing is blocked until files are supplied.', ready: 'Ready', noDescription: 'No description.', yes: 'Yes', no: 'No', updated: 'Updated',
        readOnly: 'Read only', deleteServer: 'Delete server', deleteServerHint: 'This removes the server and its draft file records. Published releases remain available according to retention policy.', confirmDeleteServer: 'Delete this server?',
        disableProject: 'Disable distribution', disablingProject: 'Disabling…', disableProjectHint: 'This hides the distribution from the console. Database records, releases, RustFS objects, and audit history are retained, and the console does not provide a restore action.', confirmDisableProject: 'Disable "{{name}}"?', disableProjectNamePrompt: 'Type "{{name}}" to confirm.', disableProjectNameMismatch: 'The distribution name does not match. Nothing was changed.',
        curseForgeHint: 'Importing a pack creates a new server and queues file processing.',
        regularFiles: 'Files', libraries: 'Libraries', optionalon: 'Optional on', optionaloff: 'Optional off',
        newFolder: 'New folder', newFolderName: 'Folder name', rename: 'Rename', renamePrompt: 'New file or folder name', move: 'Move', moveDestinationPrompt: 'Destination folder under Files (leave blank for the Files root)', replace: 'Replace',
        displayNamePrompt: 'Display name', optionalModePrompt: 'Optional mode: REQUIRED, OPTIONAL_ON, or OPTIONAL_OFF', optionalModeInvalid: 'Enter REQUIRED, OPTIONAL_ON, or OPTIONAL_OFF.',
        confirmDeleteFolder: 'Delete this folder, {{directoryCount}} folder(s), and {{moduleCount}} file(s)?', location: 'Location', searchFiles: 'Search this location', items: 'items', sortBy: 'Sort by', size: 'Size', folder: 'Folder', folderEmpty: 'This folder is empty.', working: 'Applying changes…',
        sessionExpired: 'Session expired. Sign in again.'
    }
}

const zhTW = {
    translation: {
        brand: 'Nebula 管理台',
        tagline: '可控、可稽核的 Helios distribution 發布流程。',
        buildVersionLabel: 'Nebula 版本 {{version}}，建置 {{commit}}',
        login: '登入', username: '帳號', password: '密碼', logout: '登出',
        projects: 'Distribution', users: '帳號管理', audit: '稽核紀錄',
        newProject: '新增 distribution', name: '名稱', slug: '網址代稱', description: '描述', rss: 'RSS 網址', create: '建立', save: '儲存', cancel: '取消',
        open: '開啟', active: '已發布', draft: '草稿', revision: '修訂', publish: '發布更新', publishing: '發布中…',
        projectSettings: 'Distribution 設定', servers: '伺服器', files: '檔案與模組', releases: '發布版本', jobs: '背景工作',
        launcherDistribution: 'Launcher Distribution', launcherDistributionHint: 'Launcher 請固定使用此網址；系統會自動指向目前啟用的版本。', launcherReady: '可供 Launcher 使用', launcherUnavailable: '穩定檔不一致', launcherNotPublished: '尚未發布', activeReleaseId: '目前 Release ID', copyUrl: '複製網址', copied: '已複製',
        newServer: '新增伺服器', editServer: '編輯伺服器', serverId: '伺服器 ID', minecraft: 'Minecraft', serverVersion: '設定版本', address: '連線位址', loader: '載入器', loaderVersion: '載入器版本', mainServer: '主要伺服器', autoconnect: '自動連線', order: '排序',
        uploadModule: '上傳模組', chooseServer: '選擇伺服器', chooseFile: '選擇檔案', type: '類型', destination: '目的路徑', required: '必要', optionalOn: '選用，預設開啟', optionalOff: '選用，預設關閉', upload: '上傳',
        curseForge: '匯入 CurseForge 整合包', import: '匯入', waitingFile: '等待人工補檔', delete: '刪除', edit: '編輯',
        noProjects: '尚未建立 distribution。', noServers: '尚未建立伺服器。', noRecords: '沒有紀錄。',
        status: '狀態', attempts: '嘗試次數', progress: '進度', error: '錯誤', retry: '重試', rollback: '切換此版', retained: '已保留', removed: '已清理',
        newUser: '新增帳號', role: '角色', admin: '管理員', editor: '編輯者', auditor: '稽核員', disable: '停用', enable: '啟用', resetPassword: '重設密碼', passwordTooShort: '密碼至少需要 12 個字元。',
        forcedPassword: '更換臨時密碼', currentPassword: '目前密碼', newPassword: '新密碼', changePassword: '更換密碼',
        actor: '操作者', action: '動作', entity: '對象', time: '時間', exportCsv: '匯出 CSV', exportJson: '匯出 JSON',
        publishHint: '系統將凍結本次修訂，生成、驗證並原子切換正式版本。',
        confirmDelete: '確定刪除此項目？', confirmPublish: '確定發布目前草稿？', confirmRollback: '確定切換至此保留版本？',
        language: 'English', success: '已完成', refresh: '重新整理', projectSaved: 'Distribution 已儲存。',
        loaderNone: '無載入器', bytes: '位元組', manualUrl: '人工下載',
        versionsLoading: '正在載入版本建議…', versionsUnavailable: '無法取得版本建議，仍可手動輸入。', versionsStale: '目前顯示快取版本，仍可手動輸入。', manualVersionHint: '可從建議清單選擇，或直接輸入版本。', noCompatibleVersions: '找不到相容版本，仍可手動輸入。', selectMinecraftFirst: '請先選擇或輸入 Minecraft 版本。',
        recommendedVersion: '推薦', latestVersion: '最新', stableVersion: '穩定',
        discordClient: 'Discord Client ID', discordSmallText: 'Discord 小圖文字', discordSmallKey: 'Discord 小圖 Key',
        discordShort: 'Discord 短 ID', discordLargeText: 'Discord 大圖文字', discordLargeKey: 'Discord 大圖 Key',
        serverIcon: '伺服器圖示', javaSupported: '支援 Java 範圍', javaSuggested: '建議 Java 主版本', ramMinimum: '最低 RAM（MB）', ramRecommended: '建議 RAM（MB）', untrackedRules: '不追蹤規則', untrackedHint: '每行一條，例如 files:config/**/*.yml',
        manage: '管理', overview: '總覽', settings: '設定', serverNavigation: '伺服器管理', launcherPage: 'Launcher 頁面',
        launcherPageHint: '設定此伺服器發布至 Helios 的圖片、品牌文字與更新來源。', launcherBackground: '主視覺背景', launcherLogo: '主視覺 Logo', launcherEyebrow: 'Logo 上方小標題', launcherTitle: '主標題', launcherTagline: '說明文字', launcherNewsRss: '伺服器更新 RSS 網址',
        launcherUsesDefault: '使用 Launcher 預設內容', launcherImageConfigured: '已選擇自訂圖片', launcherImageMissing: '來源圖片不存在，請重新上傳。', launcherClearImage: '清除圖片', launcherEmptyFallback: '欄位留空時沿用 Distribution 或 Launcher 的全域預設。', launcherImageTypeError: '請選擇 PNG、JPEG 或 WebP 圖片。', launcherFallbackEyebrow: 'MAPLECRAFT SERVER', launcherFallbackTagline: '伺服器內容會顯示在這裡。',
        folders: '個資料夾', publishBlocked: '補齊檔案前無法發布。', ready: '可發布', noDescription: '沒有描述。', yes: '是', no: '否', updated: '更新時間',
        readOnly: '唯讀', deleteServer: '刪除伺服器', deleteServerHint: '這會刪除伺服器及草稿檔案紀錄；已發布版本仍依保留政策保存。', confirmDeleteServer: '確定刪除此伺服器？',
        disableProject: '停用 Distribution', disablingProject: '正在停用…', disableProjectHint: '停用後將從管理台隱藏；資料庫紀錄、發布版本、RustFS 物件與稽核紀錄都會保留，且管理台目前不提供恢復操作。', confirmDisableProject: '確定停用「{{name}}」？', disableProjectNamePrompt: '請輸入「{{name}}」以確認停用。', disableProjectNameMismatch: 'Distribution 名稱不相符，未進行任何變更。',
        curseForgeHint: '匯入整合包會建立新伺服器，並排入背景檔案處理工作。',
        regularFiles: '一般檔案', libraries: 'Libraries', optionalon: '選用，預設開啟', optionaloff: '選用，預設關閉',
        newFolder: '新增資料夾', newFolderName: '資料夾名稱', rename: '重新命名', renamePrompt: '新的檔案或資料夾名稱', move: '移動', moveDestinationPrompt: 'Files 下的目的資料夾（留空代表 Files 根目錄）', replace: '替換',
        displayNamePrompt: '顯示名稱', optionalModePrompt: '選用狀態：REQUIRED、OPTIONAL_ON 或 OPTIONAL_OFF', optionalModeInvalid: '請輸入 REQUIRED、OPTIONAL_ON 或 OPTIONAL_OFF。',
        confirmDeleteFolder: '確定刪除此資料夾、{{directoryCount}} 個子資料夾及 {{moduleCount}} 個檔案？', location: '位置', searchFiles: '搜尋目前位置', items: '個項目', sortBy: '排序', size: '大小', folder: '資料夾', folderEmpty: '此資料夾是空的。', working: '正在套用變更…',
        sessionExpired: '登入已失效，請重新登入。'
    }
}

void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: { en, 'zh-TW': zhTW },
        fallbackLng: 'zh-TW',
        supportedLngs: ['en', 'zh-TW'],
        interpolation: { escapeValue: false },
        detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] }
    })

export default i18n
