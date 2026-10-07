const TARGET = 5400;
const DEFAULT_STREAMS = [
  {name:'Freelance sprints (4 × $600)', target:2400, earned:0},
  {name:'Local business packages (3 × $500)', target:1500, earned:0},
  {name:'Sell unused stuff', target:800, earned:0},
  {name:'Quick gig work', target:700, earned:0},
];
const CHECKS = [
  'Send 15 outreach messages','Follow up on leads from 3 days ago','Post 1 portfolio/work sample',
  'List 2 items for sale','Deliver or progress one paid job','Log today\'s income here'];
const STAGES = ['contacted','replied','quoted','won','lost'];

const load = (k,d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } };
const save = (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} };
const $ = id => document.getElementById(id);
const money = n => '$' + Math.round(n).toLocaleString();

let streams = load('streams', DEFAULT_STREAMS);
let leads = load('leads', []);
const today = new Date().toISOString().slice(0,10);
let checks = load('checks', {});
if (checks.date !== today) checks = {date: today, done: []};

function totals(){
  // won leads count toward income on top of manually logged amounts
  const won = leads.filter(l=>l.stage==='won').reduce((s,l)=>s+l.value,0);
  const manual = streams.reduce((s,x)=>s+x.earned,0);
  return manual + won;
}

function render(){
  const earned = totals(), left = Math.max(0, TARGET-earned);
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate() - now.getDate() + 1;
  $('earned').textContent = money(earned);
  $('fill').style.width = Math.min(100, earned/TARGET*100) + '%';
  $('left').textContent = left ? money(left)+' to go' : 'Goal reached 🎉';
  $('pace').textContent = left ? `${daysLeft} days left → ${money(left/daysLeft)}/day needed` : '';

  $('streams').innerHTML = '';
  streams.forEach((s,i)=>{
    const r = document.createElement('div'); r.className='row';
    r.innerHTML = `<div class="name">${s.name}<div class="mut">target ${money(s.target)}</div></div>
      <input type="number" min="0" value="${s.earned}" aria-label="earned">`;
    r.querySelector('input').onchange = e => { s.earned = +e.target.value||0; save('streams',streams); render(); };
    $('streams').append(r);
  });

  $('leads').innerHTML = leads.length ? '' : '<p class="mut">No leads yet. Add your first one above.</p>';
  leads.forEach((l,i)=>{
    const r = document.createElement('div'); r.className='row';
    const name = document.createElement('div'); name.className='name'; name.textContent = l.name;
    const v = document.createElement('span'); v.className='mut'; v.textContent = money(l.value);
    const sel = document.createElement('select');
    STAGES.forEach(st=>{ const o=document.createElement('option'); o.value=o.textContent=st; o.selected=st===l.stage; sel.append(o); });
    sel.onchange = () => { l.stage = sel.value; save('leads',leads); render(); };
    const del = document.createElement('button'); del.textContent='✕';
    del.onclick = () => { leads.splice(i,1); save('leads',leads); render(); };
    r.append(name,v,sel,del); $('leads').append(r);
  });

  $('checklist').innerHTML = '';
  CHECKS.forEach((c,i)=>{
    const l = document.createElement('label');
    const cb = document.createElement('input'); cb.type='checkbox'; cb.checked = checks.done.includes(i);
    cb.onchange = () => { checks.done = cb.checked ? [...checks.done,i] : checks.done.filter(x=>x!==i); save('checks',checks); };
    l.append(cb, document.createTextNode(c)); $('checklist').append(l);
  });
}

$('leadForm').onsubmit = e => {
  e.preventDefault();
  leads.push({name:$('leadName').value.trim(), value:+$('leadValue').value||0, stage:'contacted'});
  save('leads',leads); e.target.reset(); render();
};
render();
