/**
 * Leaderboard page.
 */
import { api } from '../../js/core/api.js';

Object.assign(window.app, {
    _lbUnsub: null,
    fetchLeaderboard: async () => {
        const load = async () => {
            try {
                const r = await api.get('/leaderboard');
                window.db.leaderboard = (r.users||[]).map(x=>({id:x.uid,name:x.appName||'User',isVerified:false,score:x.score||0,kills:x.kills||0,img:x.photoUrl||`https://ui-avatars.com/api/?name=${encodeURIComponent(x.appName||'User')}`,isMe:x.uid===window.db.user_uid}));
                window.app.renderLB();
            } catch(e){}
        };
        if(window.app._lbUnsub) clearInterval(window.app._lbUnsub);
        window.app._lbUnsub = setInterval(()=>{ if(document.visibilityState==='visible'&&window.db.user_uid) load(); }, 60000);
        if(window.db.user_uid) await load();
    },
    renderLB: () => {
        const podium=document.getElementById('lb-podium'); const list=document.getElementById('lb-list'); podium.innerHTML=""; list.innerHTML="";
        if(window.db.leaderboard.length===0){ list.innerHTML="<div style='text-align:center; padding:20px; color:#aaa'>No Data Available</div>"; return; }
        const data=window.db.leaderboard; const top3=data.slice(0,3); const podiumOrder=[];
        if(top3[1]) podiumOrder.push({p:top3[1],r:2}); if(top3[0]) podiumOrder.push({p:top3[0],r:1}); if(top3[2]) podiumOrder.push({p:top3[2],r:3});
        const fmt=n=>Number(n||0).toFixed(2);
        podiumOrder.forEach(item=>{const p=item.p; const rank=item.r; const tick=p.isVerified?' <i class="fa-solid fa-circle-check" style="color:#1d9bf0;font-size:0.75rem;"></i>':''; podium.innerHTML+=`<div class="podium-item podium-${rank}"><div class="crown" style="${rank===1?'':'display:none'}"><i class="fa-solid fa-crown"></i></div><div class="p-img-box"><img src="${p.img}"><div class="p-rank-badge">${rank}</div></div><div style="font-weight:700; margin-top:10px; font-size:0.9rem;">${p.name}${tick}</div><div class="text-primary bold">₹${fmt(p.score)}</div></div>`;});
        data.slice(3).forEach((p,i)=>{ const tick=p.isVerified?' <i class="fa-solid fa-circle-check" style="color:#1d9bf0;font-size:0.78rem;"></i>':''; list.innerHTML+=`<div class="rank-item" ${p.isMe?'style="border:1px solid var(--primary); background:#eef2ff"':''}><div class="r-pos">${i+4}</div><img src="${p.img}" class="r-img"><div style="flex:1"><div style="font-weight:600">${p.name}${tick} ${p.isMe?'(You)':''}</div><div style="font-size:0.75rem; color:#aaa">Main Balance</div></div><div class="r-val">₹${fmt(p.score)}</div></div>`; });
    },
});
