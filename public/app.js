const $=id=>document.getElementById(id);
const labels={true:"ONLINE",false:"FAILED"};
function setCheck(id,value){const el=$(id);el.textContent=labels[!!value];el.className=value?"":"fail"}
function render(data){
  const ok=data.status==="GREEN";
  $("banner").className="banner "+(ok?"ok":"fail");
  $("bannerText").textContent=ok?"Control plane is GREEN":"Control plane check failed";
  $("planeBadge").textContent=ok?"GREEN":"FAILED";
  $("planeBadge").className="badge "+(ok?"ok":"fail");
  $("overall").textContent=data.control_plane||"OFFLINE";
  $("checked").textContent=data.checked_at?new Date(data.checked_at).toLocaleString():"No timestamp";
  setCheck("d1",data.checks?.d1);setCheck("kv",data.checks?.kv);setCheck("b2",data.checks?.b2);
  const sources=data.sources||[];$("sourceCount").textContent=sources.length+" registered";
  $("sources").innerHTML=sources.length?sources.map(s=>`<div class="source"><div class="source-title"><span>${escapeHtml(s.source_name)}</span><span class="state">${escapeHtml(s.status)}</span></div><small>${escapeHtml(s.source_type)} · vault ${s.vault_sync?"ON":"OFF"} · phone ${s.phone_sync?"ON":"OFF"}</small></div>`).join(""):'<p class="muted">No sources registered</p>';
}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function refresh(){
  $("banner").className="banner loading";$("bannerText").textContent="Checking control plane…";
  try{
    const response=await fetch("/control/status",{headers:{accept:"application/json"},cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"HTTP "+response.status);
    render(data);
  }catch(error){
    $("banner").className="banner fail";$("bannerText").textContent="API unavailable: "+error.message;
    $("planeBadge").textContent="FAILED";$("planeBadge").className="badge fail";$("overall").textContent="OFFLINE";$("checked").textContent="Unable to read /control/status";
    ["d1","kv","b2"].forEach(id=>setCheck(id,false));$("sourceCount").textContent="—";$("sources").innerHTML='<p class="muted">Control API unavailable</p>';
  }
}
$("refresh").addEventListener("click",refresh);refresh();
