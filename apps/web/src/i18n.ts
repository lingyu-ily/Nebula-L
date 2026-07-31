import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

const en = {
    translation: {
        brand: 'Nebula Console',
        tagline: 'Controlled releases for every Helios distribution.',
        login: 'Sign in', username: 'Username', password: 'Password', logout: 'Sign out',
        projects: 'Distributions', users: 'Accounts', audit: 'Audit log',
        newProject: 'New distribution', name: 'Name', slug: 'Slug', description: 'Description', rss: 'RSS URL', create: 'Create', save: 'Save', cancel: 'Cancel',
        open: 'Open', active: 'Active', draft: 'Draft', revision: 'Revision', publish: 'Publish update', publishing: 'Publishing…',
        projectSettings: 'Distribution settings', servers: 'Servers', files: 'Files & modules', releases: 'Releases', jobs: 'Background jobs',
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
        discordClient: 'Discord client ID', discordSmallText: 'Discord small image text', discordSmallKey: 'Discord small image key',
        discordShort: 'Discord short ID', discordLargeText: 'Discord large image text', discordLargeKey: 'Discord large image key',
        serverIcon: 'Server icon', javaSupported: 'Supported Java range', javaSuggested: 'Suggested Java major', ramMinimum: 'Minimum RAM (MB)', ramRecommended: 'Recommended RAM (MB)', untrackedRules: 'Untracked rules', untrackedHint: 'One rule per line, for example files:config/**/*.yml',
        sessionExpired: 'Session expired. Sign in again.'
    }
}

const zhTW = {
    translation: {
        brand: 'Nebula 管理台',
        tagline: '可控、可稽核的 Helios distribution 發布流程。',
        login: '登入', username: '帳號', password: '密碼', logout: '登出',
        projects: 'Distribution', users: '帳號管理', audit: '稽核紀錄',
        newProject: '新增 distribution', name: '名稱', slug: '網址代稱', description: '描述', rss: 'RSS 網址', create: '建立', save: '儲存', cancel: '取消',
        open: '開啟', active: '已發布', draft: '草稿', revision: '修訂', publish: '發布更新', publishing: '發布中…',
        projectSettings: 'Distribution 設定', servers: '伺服器', files: '檔案與模組', releases: '發布版本', jobs: '背景工作',
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
        discordClient: 'Discord Client ID', discordSmallText: 'Discord 小圖文字', discordSmallKey: 'Discord 小圖 Key',
        discordShort: 'Discord 短 ID', discordLargeText: 'Discord 大圖文字', discordLargeKey: 'Discord 大圖 Key',
        serverIcon: '伺服器圖示', javaSupported: '支援 Java 範圍', javaSuggested: '建議 Java 主版本', ramMinimum: '最低 RAM（MB）', ramRecommended: '建議 RAM（MB）', untrackedRules: '不追蹤規則', untrackedHint: '每行一條，例如 files:config/**/*.yml',
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
