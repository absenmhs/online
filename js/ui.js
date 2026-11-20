import {icon} from './icons.js';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const btn=(action,txt,cls='secondary',ic='')=>'<button type="button" data-act="'+action+'" class="'+cls+'">'+(ic?icon(ic)+' ':'')+txt+'</button>';
export const chip=(s,cls='')=>'<span class="chip '+cls+'">'+esc(s)+'</span>';
export const msg=t=>'<p class="message" role="status">'+esc(t)+'</p>';
export const card=(title,body)=>'<section class="card"><h2>'+title+'</h2>'+body+'</section>';
export const line=(a,b)=>'<div class="line"><span>'+a+'</span><b>'+b+'</b></div>';
export const empty=t=>'<div class="empty">'+esc(t)+'</div>';
