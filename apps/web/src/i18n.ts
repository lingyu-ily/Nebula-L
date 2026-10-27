import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

const en = {
    translation: {
        controlPlane: 'DISTRIBUTION CONTROL', workspace: 'Workspace', navigation: 'Main navigation', openNavigation: 'Open navigation', closeNavigation: 'Close navigation', skipContent: 'Skip to content',
        motionEffects: 'Motion effects', motionSystem: 'Motion is reduced by your system preference.', consoleHint: 'One workspace. Every distribution.', workspaceSummary: 'Workspace summary',
        projectsHint: 'Your distributions, connected. Build, manage, and publish from one place.', totalDistributions: 'Total distributions', publishedDistributions: 'Published', draftDistributions: 'Unpublished',
        loginArtEyebrow: 'YOUR NEXT RELEASE STARTS HERE', loginArtTitle: 'A universe of possibilities.', loginArtHint: 'One control center for every world you create.', loginArtFooter: 'Built for your Helios worlds', identityAccess: 'IDENTITY & ACCESS', auditTrail: 'IMMUTABLE EVENT TRAIL',

        brand: 'Nebula Console',
        tagline: 'Controlled releases for every Helios distribution.',
        buildVersionLabel: 'Nebula version {{version}}, build {{commit}}',
        login: 'Sign in', username: 'Username', password: 'Password', logout: 'Sign out',
        projects: 'Distributions', analytics: 'Launcher analytics', users: 'Accounts', audit: 'Audit log',
        newProject: 'New distribution', name: 'Name', slug: 'Slug', description: 'Description', rss: 'RSS URL', create: 'Create', save: 'Save', cancel: 'Cancel',
        open: 'Open', active: 'Active', draft: 'Draft', revision: 'Revision', notPublished: 'Not published', publish: 'Publish update', publishing: 'Publishing…',
        projectSettings: 'Distribution settings', servers: 'Servers', files: 'Files & modules', jobs: 'Background jobs',
        launcherDistribution: 'Launcher distribution', launcherDistributionHint: 'Use this stable URL in the launcher. It always serves the latest successful publish.', launcherReady: 'Ready', launcherUnavailable: 'Stable file mismatch', launcherNotPublished: 'Not published', currentPublishId: 'Current publish ID', copyUrl: 'Copy URL', copied: 'Copied',
        analyticsEyebrow: 'PRIVACY-PRESERVING METRICS', analyticsHint: 'Estimated active Launcher installations. No account or device identifiers are collected.', analyticsDistribution: 'Distribution', analyticsTimeZone: 'Days reset at midnight in Asia/Taipei.', analyticsNoProjects: 'No distributions are available.', analyticsLoading: 'Loading Launcher usage…', analyticsToday: 'Active today', analyticsEstimated: 'Estimated Launcher installations', analyticsChartTitle: 'Last 30 days', analyticsChartDescription: 'Daily active Launcher installations; the maximum is {{maximum}}.', analyticsTable: 'View daily data', analyticsDate: 'Date', analyticsActiveLaunchers: 'Active Launchers',
        newServer: 'Add server', editServer: 'Edit server', serverId: 'Server ID', minecraft: 'Minecraft', serverVersion: 'Configuration version', address: 'Address', loader: 'Loader', loaderVersion: 'Loader version', mainServer: 'Main server', autoconnect: 'Auto-connect', order: 'Order',
        saveServerOrder: 'Save order', savingServerOrder: 'Saving order…', moveServerUp: 'Move {{name}} up', moveServerDown: 'Move {{name}} down', serverPosition: 'Position {{position}}', serverMoved: 'Moved {{name}} to position {{position}}.',
        uploadModule: 'Upload module', chooseServer: 'Choose server', chooseFile: 'Choose file', type: 'Type', destination: 'Destination path', required: 'Required', optionalOn: 'Optional, on by default', optionalOff: 'Optional, off by default', upload: 'Upload', download: 'Download',
        curseForge: 'Import CurseForge pack', import: 'Import', waitingFile: 'Manual file required', delete: 'Delete', edit: 'Edit',
        noProjects: 'No distributions yet.', noServers: 'No servers yet.', noRecords: 'No records.',
        status: 'Status', attempts: 'Attempts', progress: 'Progress', error: 'Error', retry: 'Retry',
        previousPage: 'Previous', nextPage: 'Next', pageNumber: 'Page {{page}}', jobsPagination: 'Background job pages',
        newUser: 'New account', role: 'Role', admin: 'Admin', editor: 'Editor', auditor: 'Auditor', disable: 'Disable', enable: 'Enable', resetPassword: 'Reset password',
        forcedPassword: 'Change temporary password', currentPassword: 'Current password', newPassword: 'New password', changePassword: 'Change password', passwordTooShort: 'Password must contain at least 12 characters.',
        actor: 'Actor', action: 'Action', entity: 'Entity', time: 'Time', exportCsv: 'Export CSV', exportJson: 'Export JSON',
        publishHint: 'A snapshot of this draft will be generated, verified, then atomically activated.',
        confirmDelete: 'Delete this item?', confirmPublish: 'Publish this draft?',
        language: '中文', success: 'Completed', refresh: 'Refresh', projectSaved: 'Distribution saved.',
        loaderNone: 'No loader', bytes: 'bytes', manualUrl: 'Manual download',
        versionsLoading: 'Loading version suggestions…', versionsUnavailable: 'Suggestions unavailable. Enter a version manually.', versionsStale: 'Showing cached suggestions. Manual entry is available.', manualVersionHint: 'Choose a suggestion or enter a version manually.', noCompatibleVersions: 'No compatible versions found. You can still enter one manually.', selectMinecraftFirst: 'Choose or enter a Minecraft version first.',
        recommendedVersion: 'Recommended', latestVersion: 'Latest', stableVersion: 'Stable',
        discordClient: 'Discord client ID', discordSmallText: 'Discord small image text', discordSmallKey: 'Discord small image key',
        discordShort: 'Discord short ID', discordLargeText: 'Discord large image text', discordLargeKey: 'Discord large image key',
        serverIcon: 'Server icon', javaSupported: 'Supported Java range', javaSuggested: 'Suggested Java major', ramMinimum: 'Minimum RAM (MB)', ramRecommended: 'Recommended RAM (MB)', untrackedRules: 'Untracked rules', untrackedHint: 'One rule per line, for example files:config/**/*.yml',
        manage: 'Manage', overview: 'Overview', settings: 'Settings', serverNavigation: 'Server management', launcherPage: 'Launcher page',
        launcherPageHint: 'Per-server artwork, branding copy, and update feed published to Helios.', launcherBackground: 'Hero background', launcherLogo: 'Hero logo', launcherEyebrow: 'Launcher header label', launcherTitle: 'Hero title', launcherTagline: 'Hero description', launcherNewsRss: 'Server update RSS URL',
        launcherUsesDefault: 'Uses the Launcher default', launcherImageConfigured: 'Custom image selected', launcherImageMissing: 'The source image is missing. Re-upload it.', launcherClearImage: 'Clear image', launcherEmptyFallback: 'Empty fields inherit the distribution or Launcher default.', launcherImageTypeError: 'Choose a PNG, JPEG, or WebP image.', launcherFallbackEyebrow: 'MAPLECRAFT', launcherFallbackTagline: 'Server content will appear here.', launcherPreviewPlay: 'Play', launcherPreviewMods: 'Mods', launcherPreviewUpdates: 'Patch notes',
        launcherVideo: 'Hero video', launcherVideoNone: 'No video', launcherVideoUpload: 'Upload MP4 / WebM', launcherVideoExternalUnsupported: 'External video is no longer supported; remove it or choose upload/YouTube', launcherVideoExternalUrl: 'Legacy external video URL', launcherVideoYouTube: 'YouTube video', launcherVideoYouTubeUrl: 'YouTube URL', launcherVideoYouTubeHint: 'Single watch, short, youtu.be, or embed URLs are supported.', launcherVideoConfigured: 'A video is configured', launcherVideoFileRequired: 'Choose an MP4 or WebM file.', launcherVideoUrlRequired: 'Enter a video URL.', launcherVideoTypeError: 'Choose an MP4 or WebM video.', launcherClearVideo: 'Clear video', launcherVideoPreview: 'Launcher video preview', launcherVideoPreviewError: 'The video could not be previewed.', launcherPlayVideo: 'Play video', launcherPauseVideo: 'Pause video', launcherMuteVideo: 'Mute video', launcherUnmuteVideo: 'Unmute video',
        folders: 'folders', folderNavigation: 'Folder navigation', expandFolder: 'Expand {{name}} folder', collapseFolder: 'Collapse {{name}} folder', publishBlocked: 'Publishing is blocked until files are supplied.', ready: 'Ready', noDescription: 'No description.', yes: 'Yes', no: 'No', updated: 'Updated',
        readOnly: 'Read only', deleteServer: 'Delete server', deleteServerHint: 'This removes the server and its draft file records. The current stable distribution remains available until the next successful publish.', confirmDeleteServer: 'Delete this server?',
        disableProject: 'Disable distribution', disablingProject: 'Disabling…', disableProjectHint: 'This hides the distribution from the active console list while retaining its database records, RustFS objects, and stable URL. An administrator can restore or permanently delete it later.', confirmDisableProject: 'Disable "{{name}}"?', disableProjectNamePrompt: 'Type "{{name}}" to confirm.', disableProjectNameMismatch: 'The distribution name does not match. Nothing was changed.',
        disabledProjects: 'Disabled distributions', disabledAt: 'Disabled', noDisabledProjects: 'No disabled distributions.', restoreProject: 'Restore', restoringProject: 'Restoring…', confirmRestoreProject: 'Restore "{{name}}"?', purgeProject: 'Permanently delete', queueingPurge: 'Scheduling deletion…', confirmPurgeProject: 'Permanently delete "{{name}}" and all of its files? This cannot be undone.', purgeProjectNamePrompt: 'Type "{{name}}" to permanently delete it.', purgeProjectNameMismatch: 'The distribution name does not match. Nothing was changed.', purgeQueued: 'Deletion queued', purgeRunning: 'Permanently deleting…', purgeFailed: 'Deletion failed', retryPurge: 'Retry permanent deletion',
        curseForgeHint: 'Importing a pack creates a new server and queues file processing.',
        regularFiles: 'Files', libraries: 'Libraries', optionalon: 'Optional on', optionaloff: 'Optional off',
        newFolder: 'New folder', newFolderName: 'Folder name', rename: 'Rename', renamePrompt: 'New file or folder name', move: 'Move', moveDestinationPrompt: 'Destination folder under Files (leave blank for the Files root)', replace: 'Replace',
        checksumValidation: 'Validation', checksumValidationAlwaysOn: 'Always on', checksumValidationFor: 'Validate {{name}}', checksumValidationHint: 'Off: keeps an existing modified file; downloads it if missing.',
        displayNamePrompt: 'Display name', optionalModePrompt: 'Optional mode: REQUIRED, OPTIONAL_ON, or OPTIONAL_OFF', optionalModeInvalid: 'Enter REQUIRED, OPTIONAL_ON, or OPTIONAL_OFF.',
        confirmDeleteFolder: 'Delete this folder, {{directoryCount}} folder(s), and {{moduleCount}} file(s)?', confirmDeleteSelection: 'Delete {{selectedCount}} selected item(s), including {{directoryCount}} folder(s) and {{moduleCount}} file(s)?', location: 'Location', searchFiles: 'Search this location', items: 'items', selectedItems: '{{selected}} of {{total}} selected', selectAll: 'Select all visible items', selectItem: 'Select {{name}}', sortBy: 'Sort by', size: 'Size', folder: 'Folder', folderEmpty: 'This folder is empty.', working: 'Applying changes…', preparingDownload: 'Preparing ZIP download…', resizeExplorerColumns: 'Resize {{left}} and {{right}} columns',
        dropFilesAndFoldersHere: 'Drop files or folders here to upload', createFolderBatchProgress: 'Creating folder {{current}}/{{total}}: {{fileName}}', uploadBatchProgress: 'Uploading {{current}}/{{total}}: {{fileName}}', uploadBatchComplete: '{{count}} file(s) uploaded.', uploadTreeComplete: '{{folderCount}} folder(s) created and {{fileCount}} file(s) uploaded.', uploadBatchFailed: '{{completed}}/{{total}} file(s) uploaded. {{fileName}} failed: {{reason}}', uploadUnavailableHere: 'Open an uploadable folder before dropping files.', uploadFoldersFilesOnly: 'Folders can only be dropped under Files.', uploadDirectoryApiUnsupported: 'This browser cannot read dropped folders. Drop individual files instead.', uploadInvalidPath: 'The dropped folder contains an invalid path.', uploadPathConflict: 'A file or folder already exists at {{path}}.',
        sessionExpired: 'Session expired. Sign in again.'
    }
}

const zhTW = {
    translation: {
        controlPlane: 'DISTRIBUTION 管理中心', workspace: '工作空間', navigation: '主導覽', openNavigation: '開啟導覽', closeNavigation: '關閉導覽', skipContent: '跳至主要內容',
        motionEffects: '動態效果', motionSystem: '已依系統偏好減少動態效果。', consoleHint: '一個工作空間，掌握所有 Distribution。', workspaceSummary: '工作空間摘要',
        projectsHint: '集中管理每個世界，從建置、設定到發布，一站完成。', totalDistributions: 'Distribution 總數', publishedDistributions: '已發布', draftDistributions: '尚未發布',
        loginArtEyebrow: '下一次發布，從這裡開始', loginArtTitle: '每個世界，都有無限可能。', loginArtHint: '為你打造的每個世界，提供一個管理中心。', loginArtFooter: '為你的 Helios 世界而生', identityAccess: '帳號與權限', auditTrail: '完整操作軌跡',

        brand: 'Nebula',
        tagline: 'MapleCraft Launcher 發布控制台',
        buildVersionLabel: 'Nebula 版本 {{version}}，建置 {{commit}}',
        login: '登入', username: '帳號', password: '密碼', logout: '登出',
        projects: 'Distribution', analytics: 'Launcher 統計', users: '帳號管理', audit: '稽核紀錄',
        newProject: '新增 distribution', name: '名稱', slug: '網址代稱', description: '描述', rss: 'RSS 網址', create: '建立', save: '儲存', cancel: '取消',
        open: '開啟', active: '已發布', draft: '草稿', revision: '修訂', notPublished: '尚未發布', publish: '發布更新', publishing: '發布中…',
        projectSettings: 'Distribution 設定', servers: '伺服器', files: '檔案與模組', jobs: '背景工作',
        launcherDistribution: 'Launcher Distribution', launcherDistributionHint: 'Launcher 請固定使用此網址；系統會提供最近一次成功發布。', launcherReady: '可供 Launcher 使用', launcherUnavailable: '穩定檔不一致', launcherNotPublished: '尚未發布', currentPublishId: '目前發布工作 ID', copyUrl: '複製網址', copied: '已複製',
        analyticsEyebrow: '匿名且保護隱私的統計', analyticsHint: '顯示估計活躍 Launcher 安裝數；不收集帳號或裝置識別資訊。', analyticsDistribution: 'Distribution', analyticsTimeZone: '每日於 Asia/Taipei 午夜重新計算。', analyticsNoProjects: '目前沒有可查看的 Distribution。', analyticsLoading: '正在載入 Launcher 使用資料…', analyticsToday: '今日活躍', analyticsEstimated: '估計 Launcher 安裝數', analyticsChartTitle: '最近 30 天', analyticsChartDescription: '每日活躍 Launcher 安裝數，最高值為 {{maximum}}。', analyticsTable: '檢視每日資料', analyticsDate: '日期', analyticsActiveLaunchers: '活躍 Launcher',
        newServer: '新增伺服器', editServer: '編輯伺服器', serverId: '伺服器 ID', minecraft: 'Minecraft', serverVersion: '設定版本', address: '連線位址', loader: '載入器', loaderVersion: '載入器版本', mainServer: '主要伺服器', autoconnect: '自動連線', order: '排序',
        saveServerOrder: '儲存排序', savingServerOrder: '正在儲存排序…', moveServerUp: '將 {{name}} 上移', moveServerDown: '將 {{name}} 下移', serverPosition: '第 {{position}} 順位', serverMoved: '已將 {{name}} 移至第 {{position}} 順位。',
        uploadModule: '上傳模組', chooseServer: '選擇伺服器', chooseFile: '選擇檔案', type: '類型', destination: '目的路徑', required: '必要', optionalOn: '選用，預設開啟', optionalOff: '選用，預設關閉', upload: '上傳', download: '下載',
        curseForge: '匯入 CurseForge 整合包', import: '匯入', waitingFile: '等待人工補檔', delete: '刪除', edit: '編輯',
        noProjects: '尚未建立 distribution。', noServers: '尚未建立伺服器。', noRecords: '沒有紀錄。',
        status: '狀態', attempts: '嘗試次數', progress: '進度', error: '錯誤', retry: '重試',
        previousPage: '上一頁', nextPage: '下一頁', pageNumber: '第 {{page}} 頁', jobsPagination: '背景工作分頁',
        newUser: '新增帳號', role: '角色', admin: '管理員', editor: '編輯者', auditor: '稽核員', disable: '停用', enable: '啟用', resetPassword: '重設密碼', passwordTooShort: '密碼至少需要 12 個字元。',
        forcedPassword: '更換臨時密碼', currentPassword: '目前密碼', newPassword: '新密碼', changePassword: '更換密碼',
        actor: '操作者', action: '動作', entity: '對象', time: '時間', exportCsv: '匯出 CSV', exportJson: '匯出 JSON',
        publishHint: '系統將凍結目前草稿，生成、驗證並原子切換正式版本。',
        confirmDelete: '確定刪除此項目？', confirmPublish: '確定發布目前草稿？',
        language: 'English', success: '已完成', refresh: '重新整理', projectSaved: 'Distribution 已儲存。',
        loaderNone: '無載入器', bytes: '位元組', manualUrl: '人工下載',
        versionsLoading: '正在載入版本建議…', versionsUnavailable: '無法取得版本建議，仍可手動輸入。', versionsStale: '目前顯示快取版本，仍可手動輸入。', manualVersionHint: '可從建議清單選擇，或直接輸入版本。', noCompatibleVersions: '找不到相容版本，仍可手動輸入。', selectMinecraftFirst: '請先選擇或輸入 Minecraft 版本。',
        recommendedVersion: '推薦', latestVersion: '最新', stableVersion: '穩定',
        discordClient: 'Discord Client ID', discordSmallText: 'Discord 小圖文字', discordSmallKey: 'Discord 小圖 Key',
        discordShort: 'Discord 短 ID', discordLargeText: 'Discord 大圖文字', discordLargeKey: 'Discord 大圖 Key',
        serverIcon: '伺服器圖示', javaSupported: '支援 Java 範圍', javaSuggested: '建議 Java 主版本', ramMinimum: '最低 RAM（MB）', ramRecommended: '建議 RAM（MB）', untrackedRules: '不追蹤規則', untrackedHint: '每行一條，例如 files:config/**/*.yml',
        manage: '管理', overview: '總覽', settings: '設定', serverNavigation: '伺服器管理', launcherPage: 'Launcher 頁面',
        launcherPageHint: '設定此伺服器發布至 Helios 的圖片、品牌文字與更新來源。', launcherBackground: '主視覺背景', launcherLogo: '主視覺 Logo', launcherEyebrow: 'Launcher 頁首小標題', launcherTitle: '主標題', launcherTagline: '說明文字', launcherNewsRss: '伺服器更新 RSS 網址',
        launcherUsesDefault: '使用 Launcher 預設內容', launcherImageConfigured: '已選擇自訂圖片', launcherImageMissing: '來源圖片不存在，請重新上傳。', launcherClearImage: '清除圖片', launcherEmptyFallback: '欄位留空時沿用 Distribution 或 Launcher 的全域預設。', launcherImageTypeError: '請選擇 PNG、JPEG 或 WebP 圖片。', launcherFallbackEyebrow: 'MAPLECRAFT', launcherFallbackTagline: '伺服器內容會顯示在這裡。', launcherPreviewPlay: '開始遊戲', launcherPreviewMods: '模組', launcherPreviewUpdates: '更新說明',
        launcherVideo: '主視覺影片', launcherVideoNone: '不使用影片', launcherVideoUpload: '上傳 MP4／WebM', launcherVideoExternalUnsupported: '已停止支援外部影片；請移除或改用上傳／YouTube', launcherVideoExternalUrl: '舊外部影片網址', launcherVideoYouTube: 'YouTube 影片', launcherVideoYouTubeUrl: 'YouTube 網址', launcherVideoYouTubeHint: '支援單一 watch、Shorts、youtu.be 或 embed 網址。', launcherVideoConfigured: '已設定影片', launcherVideoFileRequired: '請選擇 MP4 或 WebM 檔案。', launcherVideoUrlRequired: '請輸入影片網址。', launcherVideoTypeError: '請選擇 MP4 或 WebM 影片。', launcherClearVideo: '清除影片', launcherVideoPreview: 'Launcher 影片預覽', launcherVideoPreviewError: '無法預覽影片。', launcherPlayVideo: '播放影片', launcherPauseVideo: '暫停影片', launcherMuteVideo: '影片靜音', launcherUnmuteVideo: '取消影片靜音',
        folders: '個資料夾', folderNavigation: '資料夾導覽', expandFolder: '展開 {{name}} 資料夾', collapseFolder: '收合 {{name}} 資料夾', publishBlocked: '補齊檔案前無法發布。', ready: '可發布', noDescription: '沒有描述。', yes: '是', no: '否', updated: '更新時間',
        readOnly: '唯讀', deleteServer: '刪除伺服器', deleteServerHint: '這會刪除伺服器及草稿檔案紀錄；目前的 stable distribution 會維持可用，直到下次成功發布。', confirmDeleteServer: '確定刪除此伺服器？',
        disableProject: '停用 Distribution', disablingProject: '正在停用…', disableProjectHint: '停用後將從使用中的管理台清單隱藏，但保留資料庫紀錄、RustFS 物件及 stable URL；管理員之後可恢復或永久刪除。', confirmDisableProject: '確定停用「{{name}}」？', disableProjectNamePrompt: '請輸入「{{name}}」以確認停用。', disableProjectNameMismatch: 'Distribution 名稱不相符，未進行任何變更。',
        disabledProjects: '已停用 Distribution', disabledAt: '停用時間', noDisabledProjects: '沒有已停用的 Distribution。', restoreProject: '恢復', restoringProject: '正在恢復…', confirmRestoreProject: '確定恢復「{{name}}」？', purgeProject: '永久刪除', queueingPurge: '正在排入刪除…', confirmPurgeProject: '確定永久刪除「{{name}}」及其所有檔案？此操作無法復原。', purgeProjectNamePrompt: '請輸入「{{name}}」以永久刪除。', purgeProjectNameMismatch: 'Distribution 名稱不相符，未進行任何變更。', purgeQueued: '等待永久刪除', purgeRunning: '正在永久刪除…', purgeFailed: '永久刪除失敗', retryPurge: '重試永久刪除',
        curseForgeHint: '匯入整合包會建立新伺服器，並排入背景檔案處理工作。',
        regularFiles: '一般檔案', libraries: 'Libraries', optionalon: '選用，預設開啟', optionaloff: '選用，預設關閉',
        newFolder: '新增資料夾', newFolderName: '資料夾名稱', rename: '重新命名', renamePrompt: '新的檔案或資料夾名稱', move: '移動', moveDestinationPrompt: 'Files 下的目的資料夾（留空代表 Files 根目錄）', replace: '替換',
        checksumValidation: '校驗', checksumValidationAlwaysOn: '固定開啟', checksumValidationFor: '校驗 {{name}}', checksumValidationHint: '關閉後會保留本機已修改檔案；檔案不存在時仍會下載。',
        displayNamePrompt: '顯示名稱', optionalModePrompt: '選用狀態：REQUIRED、OPTIONAL_ON 或 OPTIONAL_OFF', optionalModeInvalid: '請輸入 REQUIRED、OPTIONAL_ON 或 OPTIONAL_OFF。',
        confirmDeleteFolder: '確定刪除此資料夾、{{directoryCount}} 個子資料夾及 {{moduleCount}} 個檔案？', confirmDeleteSelection: '確定刪除選取的 {{selectedCount}} 個項目？共包含 {{directoryCount}} 個資料夾及 {{moduleCount}} 個檔案。', location: '位置', searchFiles: '搜尋目前位置', items: '個項目', selectedItems: '已選取 {{selected}}／{{total}} 個項目', selectAll: '選取目前可見的所有項目', selectItem: '選取 {{name}}', sortBy: '排序', size: '大小', folder: '資料夾', folderEmpty: '此資料夾是空的。', working: '正在套用變更…', preparingDownload: '正在準備 ZIP 下載…', resizeExplorerColumns: '調整 {{left}} 與 {{right}} 欄寬',
        dropFilesAndFoldersHere: '將檔案或資料夾拖放到這裡上傳', createFolderBatchProgress: '正在建立資料夾 {{current}}／{{total}}：{{fileName}}', uploadBatchProgress: '正在上傳 {{current}}／{{total}}：{{fileName}}', uploadBatchComplete: '已上傳 {{count}} 個檔案。', uploadTreeComplete: '已建立 {{folderCount}} 個資料夾並上傳 {{fileCount}} 個檔案。', uploadBatchFailed: '已上傳 {{completed}}／{{total}} 個檔案；{{fileName}} 失敗：{{reason}}', uploadUnavailableHere: '請先開啟可上傳的資料夾，再拖放檔案。', uploadFoldersFilesOnly: '資料夾只能拖放到 Files 底下。', uploadDirectoryApiUnsupported: '此瀏覽器無法讀取拖入的資料夾，請改為拖放個別檔案。', uploadInvalidPath: '拖入的資料夾包含無效路徑。', uploadPathConflict: '{{path}} 已有同名檔案或資料夾。',
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
