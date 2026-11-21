var tiers=["Sub 3","LTN","MTN","HTN","Chadlite","True Adam"];
var ranges=["0–2","2–4","4–6","6–7.5","7.5–9","9–10"];
var advice=["ВОЗЬМИ СЕБЯ В РУКИ, РЯДОВОЙ","СОБЕРИСЬ, РЯДОВОЙ","ЕСТЬ НАД ЧЕМ РАБОТАТЬ","ДЕРЖИ СТРОЙ","ПОЧТИ НА ВЕРШИНЕ","ЛЕГЕНДА. ДЕРЖИ ПЛАНКУ"];
function go(id){
  if(!document.getElementById(id))id="home";
  document.querySelectorAll(".scr").forEach(function(s){s.classList.toggle("on",s.id===id)});
  document.querySelectorAll(".tab").forEach(function(t){t.classList.toggle("on",t.dataset.t===id)});
  if(location.hash!=="#"+id)location.hash=id;
  window.scrollTo(0,0);
}
document.querySelectorAll(".tab").forEach(function(t){t.onclick=function(){go(t.dataset.t)}});
window.addEventListener("hashchange",function(){go(location.hash.slice(1))});
document.getElementById("file").onchange=document.getElementById("cam").onchange=function(e){
  var f=e.target.files[0];if(!f)return;
  var r=new FileReader();r.onload=function(){document.getElementById("ph").innerHTML='<img alt="" src="'+r.result+'">'};r.readAsDataURL(f);
};
function scan(){
  var ph=document.getElementById("ph");
  var n=document.createElement("span");n.textContent="scanning...";n.style.cssText="position:absolute;bottom:8px;background:var(--fg);color:var(--bg);padding:2px 8px;border-radius:6px";ph.appendChild(n);
  setTimeout(function(){
    n.remove();
    var s=Math.round(Math.random()*100)/10;
    var i=s<2?0:s<4?1:s<6?2:s<7.5?3:s<9?4:5;
    document.getElementById("tier").textContent=tiers[i];
    document.getElementById("adv").textContent=advice[i];
    document.getElementById("dTier").textContent=tiers[i];
    document.getElementById("dRange").textContent=ranges[i];
    document.getElementById("score").textContent=s.toFixed(1);
    document.getElementById("sbar").style.width=(s*10)+"%";
    document.getElementById("res").style.display="block";
    var a=document.getElementById("acc");a.classList.remove("open");a.style.display="block";
  },1200);
}
function bm(m){
  var o=m==='open';
  document.getElementById("bopen").style.display=o?"block":"none";
  document.getElementById("bfriend").style.display=o?"none":"block";
  document.getElementById("bo").classList.toggle("on",o);
  document.getElementById("bf").classList.toggle("on",!o);
}
function theme(){
  var r=document.documentElement,d=r.getAttribute("data-theme")==="dark"||(!r.getAttribute("data-theme")&&matchMedia("(prefers-color-scheme:dark)").matches);
  r.setAttribute("data-theme",d?"light":"dark");
}
go(location.hash.slice(1)||"home");
