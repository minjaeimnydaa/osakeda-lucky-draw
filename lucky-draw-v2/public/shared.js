export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export async function api(action, data, event) {
  const query = new URLSearchParams({ action }); if (event) query.set('event', event);
  let response;
  try { response = await fetch(`/api/index?${query}`, { ...(data === undefined ? { cache:'no-store' } : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...data, ...(event ? { event } : {}) }) }), signal:AbortSignal.timeout(data === undefined ? 10000 : 20000) }); }
  catch { const error = new Error('연결이 지연되고 있어요. 상태를 다시 확인해 주세요.'); error.uncertain = data !== undefined; throw error; }
  let result; try { result = await response.json(); } catch { const error = new Error('응답을 확인하지 못했어요. 상태를 다시 확인해 주세요.'); error.uncertain = data !== undefined; throw error; }
  if (!response.ok) { const error = new Error(result.error); error.status = response.status; throw error; } return result;
}
let timer;
export function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(timer); timer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
export const formatDate = value => new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', month:'2-digit', day:'2-digit' }).format(new Date(value));
export function download(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function csv(rows, name) {
  const text = rows.map(row => row.map(x => { let v = String(x ?? ''); if (/^[=+@\-\t\r]/.test(v)) v = `'${v}`; return `"${v.replace(/"/g, '""')}"`; }).join(',')).join('\r\n');
  download(new Blob(['\ufeff' + text], {type:'text/csv;charset=utf-8'}), name);
}
