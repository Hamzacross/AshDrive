'use strict';

const messages = {
  en: {
    watching: 'Watching for drives', dashboard: 'Backup dashboard', refresh: 'Refresh', addDrive: 'Add drive',
    registered: 'Registered drives', connected: 'Connected now', automatic: 'Auto backup', latest: 'Latest backup',
    search: 'Find a drive…', allDrives: 'All drives', connectedFilter: 'Connected', awayFilter: 'Not connected',
    automaticFilter: 'Automatic', askFilter: 'Ask before backup', noResults: 'No drives match this search.',
    noDrives: 'No drives yet', noDrivesHint: 'Plug in a flash drive, then click Add drive to start backing it up.',
    backupLog: 'BACKUP LOG', recentActivity: 'Backup history', latestEvents: 'Recent backups · click for details',
    emptyActivity: 'Your backup history will appear here.', privacyFooter: 'Local backups · your files stay on your devices',
    addTitle: 'Add a drive', detectedDrive: 'Detected drive', name: 'Name', namePlaceholder: 'e.g. My Photos',
    backupFolder: 'Backup folder', backupFolderPlaceholder: 'Where backups are stored', browse: 'Browse…',
    autoTitle: 'Back up automatically', autoHint: "Copy this drive as soon as it's plugged in, even when AshDrive is in the tray.",
    cancel: 'Cancel', add: 'Add', settings: 'Settings', startLogin: 'Start AshDrive when I log in',
    startLoginHint: 'Runs in the background so backups start the moment you plug in a drive.', done: 'Done', close: 'Close',
    language: 'Language', english: 'English', arabic: 'العربية', about: 'About AshDrive', aboutDescription: 'Local, incremental backups for removable drives.',
    repository: 'Source code', license: 'MIT License', version: 'Version', noDriveDetected: 'No removable drive detected. Plug one in and click Refresh.',
    detected: 'Detected', removable: 'Removable drive', neverBackedUp: 'Never backed up', lastBackup: 'Last backup',
    lastAttempt: 'Last attempt', copied: 'copied', unchanged: 'unchanged', errors: 'errors', failed: 'failed',
    incomplete: 'incomplete', stopped: 'stopped', backingUp: 'Backing up', present: 'Connected', notPlugged: 'Not connected',
    copyProgress: 'Copying', files: 'files', freeOf: 'free of', backUpNow: 'Back up now', stop: 'Stop',
    autoOn: 'Auto: On', autoOff: 'Auto: Off', remove: 'Remove', confirmRemove: 'Confirm?', pluggedIn: 'is plugged in',
    backupTo: 'Back up to', questionMark: '?', notNow: 'Not now', backUp: 'Back up',
    drive: 'drive', drives: 'drives', complete: 'complete', warning: 'warning', statusFailed: 'failed',
    scanFailed: 'Drive scan failed', noLabel: 'No label', askBefore: 'Ask before backup', filterDrives: 'Filter drives',
    never: 'never', justNow: 'just now', minuteAgo: 'min ago', hourAgo: 'hr ago', dayAgo: 'day ago',
    historyTitle: 'Backup details', historyDate: 'Created', historySummary: 'Summary', changedFiles: 'Files added or updated',
    noFilesChanged: 'No files were copied in this backup.', added: 'Added', updated: 'Updated', failedFiles: 'Files that could not be copied',
    fileCount: 'files', bytesCopied: 'Data copied',
    retainedTitle: 'Files kept locally because they are no longer on the drive',
    keptLocal: 'Kept locally',
    scanned: 'Files checked', duration: 'Duration', seconds: 'sec',
    windows: 'Windows', macOS: 'macOS', linux: 'Linux',
  },
  ar: {
    watching: 'مراقبة وحدات التخزين', dashboard: 'لوحة النسخ الاحتياطي', refresh: 'تحديث', addDrive: 'إضافة وحدة',
    registered: 'الوحدات المسجلة', connected: 'المتصلة الآن', automatic: 'النسخ التلقائي', latest: 'آخر نسخة احتياطية',
    search: 'ابحث عن وحدة…', allDrives: 'كل الوحدات', connectedFilter: 'متصلة', awayFilter: 'غير متصلة',
    automaticFilter: 'نسخ تلقائي', askFilter: 'طلب تأكيد', noResults: 'لا توجد وحدات تطابق البحث.',
    noDrives: 'لا توجد وحدات بعد', noDrivesHint: 'صِل وحدة تخزين، ثم اضغط «إضافة وحدة» لبدء إعداد النسخ الاحتياطي.',
    backupLog: 'سجل النسخ', recentActivity: 'سجل النسخ الاحتياطي', latestEvents: 'النسخ الأخيرة · اضغط للتفاصيل',
    emptyActivity: 'سيظهر سجل النسخ الاحتياطي هنا.', privacyFooter: 'نسخ محلية · تبقى ملفاتك على أجهزتك',
    addTitle: 'إضافة وحدة تخزين', detectedDrive: 'الوحدة المكتشفة', name: 'الاسم', namePlaceholder: 'مثال: صوري',
    backupFolder: 'مجلد النسخ الاحتياطي', backupFolderPlaceholder: 'مكان حفظ النسخ', browse: 'استعراض…',
    autoTitle: 'النسخ الاحتياطي تلقائياً', autoHint: 'انسخ هذه الوحدة فور توصيلها، حتى عند تشغيل AshDrive في شريط النظام.',
    cancel: 'إلغاء', add: 'إضافة', settings: 'الإعدادات', startLogin: 'تشغيل AshDrive عند تسجيل الدخول',
    startLoginHint: 'يعمل في الخلفية لبدء النسخ فور توصيل الوحدة.', done: 'تم', close: 'إغلاق',
    language: 'اللغة', english: 'English', arabic: 'العربية', about: 'حول AshDrive', aboutDescription: 'نسخ محلية وتدريجية لوحدات التخزين القابلة للإزالة.',
    repository: 'الشيفرة المصدرية', license: 'رخصة MIT', version: 'الإصدار', noDriveDetected: 'لم يتم العثور على وحدة قابلة للإزالة. صِل وحدة ثم اضغط تحديث.',
    detected: 'تم اكتشاف', removable: 'وحدة تخزين قابلة للإزالة', neverBackedUp: 'لم يتم النسخ بعد', lastBackup: 'آخر نسخة',
    lastAttempt: 'آخر محاولة', copied: 'ملفات منسوخة', unchanged: 'دون تغيير', errors: 'أخطاء', failed: 'فشل',
    incomplete: 'غير مكتمل', stopped: 'متوقف', backingUp: 'جارٍ النسخ', present: 'متصلة', notPlugged: 'غير متصلة',
    copyProgress: 'جارٍ نسخ', files: 'ملفات', freeOf: 'متاح من', backUpNow: 'نسخ الآن', stop: 'إيقاف',
    autoOn: 'تلقائي: مفعّل', autoOff: 'تلقائي: متوقف', remove: 'إزالة', confirmRemove: 'تأكيد؟', pluggedIn: 'متصلة',
    backupTo: 'هل تريد النسخ إلى', questionMark: '؟', notNow: 'ليس الآن', backUp: 'نسخ',
    drive: 'وحدة', drives: 'وحدات', complete: 'مكتمل', warning: 'تحذير', statusFailed: 'فشل',
    scanFailed: 'تعذر فحص الوحدات', noLabel: 'بلا تسمية', askBefore: 'طلب تأكيد قبل النسخ', filterDrives: 'تصفية الوحدات',
    never: 'أبداً', justNow: 'الآن', minuteAgo: 'د', hourAgo: 'س', dayAgo: 'يوم',
    historyTitle: 'تفاصيل النسخة الاحتياطية', historyDate: 'تاريخ الإنشاء', historySummary: 'الملخص', changedFiles: 'الملفات المضافة أو المحدّثة',
    noFilesChanged: 'لم يتم نسخ أي ملفات في هذه العملية.', added: 'أُضيف', updated: 'حُدّث', failedFiles: 'ملفات تعذر نسخها',
    fileCount: 'ملفات', bytesCopied: 'البيانات المنسوخة',
    retainedTitle: 'ملفات احتُفظ بها محلياً لأنها لم تعد على الوحدة',
    keptLocal: 'احتُفظ بها محلياً',
    scanned: 'ملفات تم فحصها', duration: 'المدة', seconds: 'ث',
    windows: 'ويندوز', macOS: 'macOS', linux: 'لينكس',
  },
};

let language = 'en';
function setLanguage(next) {
  language = next === 'ar' ? 'ar' : 'en';
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.dataset.language = language;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (messages[language][key]) element.textContent = messages[language][key];
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = messages[language][element.dataset.i18nPlaceholder] || '';
  }
  for (const element of document.querySelectorAll('[data-i18n-aria]')) {
    element.setAttribute('aria-label', messages[language][element.dataset.i18nAria] || '');
  }
  return language;
}

function t(key) { return messages[language][key] || messages.en[key] || key; }
window.ashI18n = { setLanguage, t, get language() { return language; } };
