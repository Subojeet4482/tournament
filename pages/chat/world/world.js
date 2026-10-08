/**
 * World chat stream + send.
 */
import { api } from '../../../js/core/api.js';

Object.assign(window.chat, {
    /* ---------- 3. WORLD CHAT ---------- */
    loadWorld(){}, // opened via streamWorld
    streamWorld(){
        if(this._unsubs.world){ this._unsubs.world(); }
        let sig='', busy=false;
        const pull = async ()=>{
            if(busy || document.visibilityState!=='visible') return; busy=true;
            try{
                const r = await api.chat.get('/world/messages');
                const items = (r.messages||[]).map(m=>({...m, photoURL:m.photoUrl, createdAt:{seconds:Math.floor((m.createdAt||0)/1000)}}));
                const s = items.map(m=>m.id).join(',')+items.length; if(s===sig) return; sig=s;
                const box = document.getElementById('wc-messages'); if(!box) return;
                const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
                box.innerHTML = items.map(m=>this._renderMsg(m,'world')).join('') || '<div class="empty-state"><i class="fa-solid fa-comments"></i><div>Be the first to say hi</div></div>';
                if(stick) box.scrollTop = box.scrollHeight;
                const pinned = items.filter(m=>m.pinned);
                if(pinned.length){
                    const p = pinned[pinned.length-1], pb = document.getElementById('wc-pinned');
                    pb.classList.remove('hidden');
                    pb.innerHTML = '<i class="fa-solid fa-thumbtack"></i> <b>Pinned:</b> ' + this._safe(p.text||'[media]');
                }
            }catch(e){} finally{ busy=false; }
        };
        pull(); const t = setInterval(pull, 4000);
        this._unsubs.world = ()=>clearInterval(t); this._pullWorld = ()=>{ sig=''; return pull(); };
    },
    async sendWorld(){
        const inp = document.getElementById('wc-input');
        const text = inp.value.trim(); if(!text) return;
        inp.value = '';
        if(this._replyTo && this._replyTo.wc) this.cancelReply('wc');
        try{ await api.chat.post('/world/send',{text}); if(this._pullWorld) this._pullWorld(); }
        catch(e){ inp.value = text; ui.toast(e.message||'Could not send'); }
    },
    togglePinnedView(){ document.getElementById('wc-pinned').classList.toggle('hidden'); },
});
