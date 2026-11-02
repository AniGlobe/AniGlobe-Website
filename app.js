(function(){
var SL=String.fromCharCode(47,47),Q=String.fromCharCode(34);
var E='https:'+SL+'graphql.anilist.co';
var T='query{User(name:'+Q+'N'+Q+'){name createdAt statistics{anime{count minutesWatched meanScore genres(limit:5,sort:COUNT_DESC){genre count}}}}}';
var U=document.getElementById('u'),B=document.getElementById('b'),ST=document.getElementById('s'),O=document.getElementById('o');
function OK(n){if(n.length<2||n.length>32)return false;for(var i=0;i<n.length;i++){var c=n.charCodeAt(i);if(!((c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===95||c===45))return false}return true}
function H(x){return String(x).replace(/[&<>]/g,function(m){return m==='&'?'&amp;':m==='<'?'&lt;':'&gt;'})}
async function GO(){
var n=U.value.trim();
if(!n||!OK(n)){ST.textContent='Enter a valid username.';ST.className='status error';return}
B.disabled=true;B.textContent='Wait';ST.textContent='Fetching';ST.className='status';O.innerHTML='';
try{
var r=await fetch(E,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:T.split('N').join(n)})});
if(!r.ok)throw new Error('HTTP '+r.status);
var j=await r.json();
if(j.errors&&j.errors.length)throw new Error(j.errors[0].message);
if(!j.data||!j.data.User)throw new Error('No user '+n);
var u=j.data.User,a=u.statistics.anime;
var h=Math.round((a.minutesWatched||0)/60),mx=1,i;
for(i=0;i<a.genres.length;i++)if(a.genres[i].count>mx)mx=a.genres[i].count;
var yr=u.createdAt?new Date(u.createdAt*1000).getFullYear():'';
var z='<div class=card><h2>'+H(u.name)+'</h2><div class=since>'+(yr?'since '+yr:'')+'</div><div class=stats><div><b>'+h+'</b><span>hours</span></div><div><b>'+a.count+'</b><span>titles</span></div><div><b>'+(a.meanScore||'-')+'</b><span>mean</span></div></div>';
for(i=0;i<a.genres.length;i++){var g=a.genres[i],w=Math.max(6,Math.round(g.count/mx*100));z+='<div class=genre><span class=name>'+H(g.genre)+'</span><div class=bar><i style="width:'+w+'%"></i></div><span class=count>'+g.count+'</span></div>'}
z+='</div>';O.innerHTML=z;ST.textContent='';
}catch(e){ST.textContent=e.message;ST.className='status error'}
finally{B.disabled=false;B.textContent='Build'}
}
B.addEventListener('click',GO);
U.addEventListener('keydown',function(ev){if(ev.key==='Enter')GO()});
})();
