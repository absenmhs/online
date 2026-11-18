// Tambahkan ke PROYEK AKTIF di Apps Script. Jangan menggandakan doPost.
function mhsWebSpreadsheet_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('MHS_SPREADSHEET_ID');
  if (!id) throw new Error('MHS_SPREADSHEET_ID belum diatur.');
  return SpreadsheetApp.openById(id);
}

// Gateway asli menangani autentikasi, otorisasi, transaksi dan format JSON.
function mhsWebPost_(e) {
  var result = apiHandlePost_(e);
  if (result.ok && result.code === 'AUTHENTICATED' && !result.token && result.employeeId) {
    result.serverEpoch = Date.now();
    if (result.role === 'EMPLOYEE' && !result.mustChangePassword && apiPoCAllowEmployee_(result.employeeId)) {
      try {
        var profile = awPoCProfile_(mhsWebSpreadsheet_(), result.employeeId);
        if (profile) { result.name = profile.name; result.unit = profile.unit; }
        result.shifts = {};
        ['CHECKIN','CHECKOUT'].forEach(function(action) {
          var rule = arEvaluateAttendance(result.employeeId, action, new Date(result.serverEpoch));
          result.shifts[action] = {shiftDate:rule.shiftDate || '', scheduleId:rule.scheduleId || '',
            shiftCode:rule.shiftCode || '', timeStatus:rule.timeStatus || ''};
        });
      } catch (err) { result.contextWarning = 'SCHEDULE_CONTEXT_UNAVAILABLE'; }
    }
  }
  return apiToOutput_(result);
}
