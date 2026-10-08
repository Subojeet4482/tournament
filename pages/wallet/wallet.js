/**
 * Wallet page: balance card + transactions.
 */
import { api } from '../../js/core/api.js';

Object.assign(window.app, {
    renderWallet: () => {
        const _dep=parseFloat(window.db.depositBalance||0);
        const _wd=parseFloat(window.db.withdrawBalance||0);
        const _tot=_dep+_wd;
        window.db.balance=_tot;
        document.getElementById('wallet-balance').innerText=_tot.toFixed(2);
        document.getElementById('header-coins').innerText=Math.floor(_tot);
        const dEl=document.getElementById('wallet-deposit-bal'); if(dEl) dEl.innerText=_dep.toFixed(2);
        const wEl=document.getElementById('wallet-withdraw-bal'); if(wEl) wEl.innerText=_wd.toFixed(2);
        const tdEl=document.getElementById('wallet-total-deposit'); if(tdEl) tdEl.innerText=parseFloat(window.db.user_data.totalDeposited||0).toFixed(0);
        const twEl=document.getElementById('wallet-total-withdraw'); if(twEl) twEl.innerText=parseFloat(window.db.user_data.totalWithdrawn||0).toFixed(0);
        const c=document.getElementById('trx-list'); c.innerHTML="";
        if(window.db.trx.length===0){ c.innerHTML="<div style='text-align:center; padding:10px; color:#aaa'>No transactions yet. Add money or play a match to get started.</div>"; return; }
       // Only show deposits & withdrawals from last 7 days (Point 2)
        const cutoff = Date.now() - 7*24*60*60*1000;
        const filtered = window.db.trx.filter(t => (t.type==='deposit'||t.type==='withdraw'||t.type==='refund'||t.type==='transfer') && (!t._ms || t._ms>=cutoff));
        if(filtered.length===0){ c.innerHTML="<div style='text-align:center; padding:10px; color:#aaa'>No deposits, withdrawals, transfers or refunds in the last 7 days. Your recent activity will appear here.</div>"; return; }
        filtered.forEach(t=>{ c.innerHTML+=window.app.trxRow(t); });
    },
    fetchTransactions: async () => {
        try {
            const r=await api.get('/wallet/history?limit=50');
            const list=(r.items||[]).map(t=>({...t,_id:t.id,_ms:t.createdAt||Date.parse(t.date)||0}));
            list.sort((a,b)=>(b._ms||0)-(a._ms||0)); window.db.trx=list;
            // Resume UPI deposits that are still waiting for the bank mail (recent ones only)
            list.filter(t=>t.type==='deposit'&&t.method==='UPI'&&t.status==='pending'&&t.trxId&&Date.now()-t._ms<30*60*1000).forEach(t=>{
                if(!window.app._activeDepositPolls[t.trxId]) window.app.startDepositPoll(t.trxId, parseFloat(String(t.amount).replace(/[^\d.]/g,'')), window.db.user_uid, {overlay:false});
            });
        } catch(e){}
    },
});
