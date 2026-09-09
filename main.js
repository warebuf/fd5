(function(){
  "use strict";

  // ---------- setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const LW = 1300, LH = 680; // logical size
  const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fitCanvas(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = LW * dpr;
    canvas.height = LH * dpr;
    canvas.style.width = Math.min(LW, window.innerWidth - 40) + 'px';
    const scale = Math.min(LW, window.innerWidth - 40) / LW;
    canvas.style.height = (LH * scale) + 'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  const COLOR = {
    bg:'#12151c', surface:'#1a1f29', surface2:'#212736', surface3:'#2a3244',
    line:'#333c52', lineSoft:'#242c3c',
    text:'#e9ecf3', textDim:'#97a1b8', textFaint:'#5c6580',
    mana:'#52d6c9', manaDim:'#28524d',
    p1:'#e8a054', p1dim:'#4d3c26',
    p2:'#7b93ff', p2dim:'#2c3352',
    danger:'#e2604f', dangerDim:'#4a2822',
    good:'#6fcf8f', goodDim:'#274734'
  };

  // ---------- roster ----------
  const ROSTER = [
    { key:'vanguard',    name:'Vanguard',    atk:3, hp:4, glyph:'melee',
      action:'Attacks the enemy in the earliest unresolved slot.' },
    { key:'blacksmith',  name:'Blacksmith',  atk:1, hp:4, glyph:'hammer',
      action:'Gives the next allied unit in the sequence +3 ATK this round.' },
    { key:'assassin',    name:'Assassin',    atk:4, hp:2, glyph:'arcane',
      action:'Attacks the enemy in the latest unresolved slot.' },
    { key:'guardian',    name:'Guardian',    atk:1, hp:6, glyph:'guard',
      action:'The next allied unit to act takes no damage until its action.' },
    { key:'medic',       name:'Medic',       atk:1, hp:3, glyph:'sacred',
      action:'Heals the most damaged ally for 3, then attacks.' },
    { key:'executioner', name:'Executioner', atk:2, hp:4, glyph:'axe',
      action:'Attacks the most damaged enemy; +3 damage if it is already injured.' }
  ];
  const BY_KEY = {};
  ROSTER.forEach(r=>{ BY_KEY[r.key] = r; });

  // ---------- rules constants ----------
  const SLOTS = 10;          // 1..10, alternating ownership
  const PER_SIDE = SLOTS/2;  // 5 slots each
  const WINS_NEEDED = 3;     // best of 5
  const STEP_MS = 850;

  // ---------- state ----------
  let uidCounter = 1;
  const state = {
    phase:'stage',       // stage | sim | roundEnd | matchEnd
    round:1,
    wins:[0,0],
    slots:new Array(SLOTS).fill(null),
    ready:[false,false],
    picked:null,         // roster key held in the palette
    simIndex:0,
    auto:true,
    focus:null,          // {actor:slotIdx, target:slotIdx|null}
    roundResult:null,    // {winner|null, why}
    matchWinner:null,
    log:[]
  };

  function pname(i){ return i===0 ? 'Player 1' : 'Player 2'; }
  function pcolor(i){ return i===0 ? COLOR.p1 : COLOR.p2; }
  function pdim(i){ return i===0 ? COLOR.p1dim : COLOR.p2dim; }

  // Slot 1 rotates between players each round. Round 1: P1 owns odd slots.
  function slotOwner(i){ return (i + (state.round-1)) % 2; }

  function log(text, color){
    state.log.push({ text, color: color || COLOR.textDim });
    if(state.log.length > 240) state.log.shift();
  }

  function makeUnit(key, owner, slot){
    const t = BY_KEY[key];
    return { uid:'u'+(uidCounter++), key, name:t.name, glyph:t.glyph,
             baseAtk:t.atk, buff:0, hp:t.hp, maxHp:t.hp,
             owner, slot, acted:false, immune:false, dead:false,
             flash:0, healFlash:0 };
  }
  function atkOf(u){ return u.baseAtk + u.buff; }
  function missing(u){ return u.maxHp - u.hp; }
  function isAlive(u){ return !!u && !u.dead; }
  function aliveOf(owner){ return state.slots.filter(u=>isAlive(u) && u.owner===owner); }
  function enemiesOf(owner){ return state.slots.filter(u=>isAlive(u) && u.owner!==owner); }
  function stagedCount(owner){ return state.slots.filter(u=>u && u.owner===owner).length; }

  // ---------- targeting ----------
  // state.slots is already in slot order, so filtered lists are too.
  function earliestUnresolvedEnemy(u){
    const es = enemiesOf(u.owner);
    return es.find(e=>!e.acted) || es[0] || null;
  }
  function latestUnresolvedEnemy(u){
    const es = enemiesOf(u.owner);
    const un = es.filter(e=>!e.acted);
    return (un.length ? un[un.length-1] : es[es.length-1]) || null;
  }
  function mostDamaged(list){
    const hurt = list.filter(x=>missing(x)>0);
    if(!hurt.length) return null;
    let best = hurt[0];
    hurt.forEach(x=>{ if(missing(x) > missing(best)) best = x; }); // ties -> earliest slot
    return best;
  }
  function nextAlly(u, mustBeUnresolved){
    for(let i=u.slot+1;i<SLOTS;i++){
      const x = state.slots[i];
      if(isAlive(x) && x.owner===u.owner && (!mustBeUnresolved || !x.acted)) return x;
    }
    return null;
  }

  // ---------- resolution ----------
  function dealDamage(target, amount){
    if(target.immune){
      log('    ' + target.name + ' is shielded — no damage.', COLOR.mana);
      return;
    }
    target.hp -= amount;
    target.flash = 1;
    if(target.hp <= 0){
      target.hp = 0;
      target.dead = true;
      log('    ' + target.name + ' (slot ' + (target.slot+1) + ') dies.', COLOR.danger);
    }
  }

  function attack(u, target, amount, verb){
    if(!target){ log('    no target — the action fizzles.', COLOR.textFaint); return; }
    state.focus.target = target.slot;
    log('    ' + verb + ' ' + target.name + ' (slot ' + (target.slot+1) + ') for ' + amount + '.', pcolor(u.owner));
    dealDamage(target, amount);
  }

  function resolveUnit(u){
    u.immune = false; // protection lasts only until this unit's own action
    state.focus = { actor:u.slot, target:null };
    log('Slot ' + (u.slot+1) + ' — ' + pname(u.owner) + "'s " + u.name + ' acts.', pcolor(u.owner));

    switch(u.key){
      case 'vanguard':
        attack(u, earliestUnresolvedEnemy(u), atkOf(u), 'strikes');
        break;

      case 'assassin':
        attack(u, latestUnresolvedEnemy(u), atkOf(u), 'strikes the latest unresolved,');
        break;

      case 'executioner': {
        const wounded = mostDamaged(enemiesOf(u.owner));
        if(wounded) attack(u, wounded, atkOf(u)+3, 'executes the wounded');
        else attack(u, earliestUnresolvedEnemy(u), atkOf(u), 'finds nobody wounded and strikes');
        break;
      }

      case 'blacksmith': {
        const a = nextAlly(u, false);
        if(a){
          a.buff += 3;
          state.focus.target = a.slot;
          log('    forges +3 ATK onto ' + a.name + ' (slot ' + (a.slot+1) + ') for this round.', COLOR.good);
        } else {
          log('    no ally later in the sequence — the buff is wasted.', COLOR.textFaint);
        }
        break;
      }

      case 'guardian': {
        const a = nextAlly(u, true);
        if(a){
          a.immune = true;
          state.focus.target = a.slot;
          log('    shields ' + a.name + ' (slot ' + (a.slot+1) + ') until it acts.', COLOR.mana);
        } else {
          log('    no ally left to shield.', COLOR.textFaint);
        }
        break;
      }

      case 'medic': {
        const a = mostDamaged(aliveOf(u.owner)); // includes itself
        if(a){
          const before = a.hp;
          a.hp = Math.min(a.maxHp, a.hp + 3);
          a.healFlash = 1;
          state.focus.target = a.slot;
          log('    heals ' + a.name + ' (slot ' + (a.slot+1) + ') for ' + (a.hp-before) + '.', COLOR.good);
        } else {
          log('    nobody is wounded — no heal.', COLOR.textFaint);
        }
        attack(u, earliestUnresolvedEnemy(u), atkOf(u), 'then strikes');
        break;
      }
    }
    u.acted = true;
  }

  function stepSim(){
    if(state.phase !== 'sim') return;
    while(state.simIndex < SLOTS){
      const u = state.slots[state.simIndex];
      state.simIndex++;
      if(!u) continue; // empty slot, nothing to resolve
      if(u.dead){
        state.focus = { actor:u.slot, target:null };
        log('Slot ' + (u.slot+1) + ' — ' + u.name + ' is dead and never acts.', COLOR.textFaint);
        return;
      }
      resolveUnit(u);
      return;
    }
    endRound();
  }

  function endRound(){
    state.phase = 'roundEnd';
    state.focus = null;
    const a0 = aliveOf(0), a1 = aliveOf(1);
    const hp0 = a0.reduce((s,u)=>s+u.hp,0), hp1 = a1.reduce((s,u)=>s+u.hp,0);
    let winner = null, why;
    if(a0.length !== a1.length){
      winner = a0.length > a1.length ? 0 : 1;
      why = 'P1 ' + a0.length + ' standing, P2 ' + a1.length;
    } else if(hp0 !== hp1){
      winner = hp0 > hp1 ? 0 : 1;
      why = 'level at ' + a0.length + ' each — P1 ' + hp0 + ' HP, P2 ' + hp1 + ' HP';
    } else {
      why = 'level on units and HP — the round is drawn';
    }
    state.roundResult = { winner, why };
    log('— Round ' + state.round + ': ' + (winner===null ? 'drawn' : pname(winner) + ' takes it') + ' (' + why + ').',
        winner===null ? COLOR.textDim : pcolor(winner));
    if(winner !== null){
      state.wins[winner]++;
      if(state.wins[winner] >= WINS_NEEDED){
        state.matchWinner = winner;
        state.phase = 'matchEnd';
        log('=== ' + pname(winner) + ' wins the match ' + state.wins[0] + '–' + state.wins[1] + '. ===', pcolor(winner));
      }
    }
  }

  function nextRound(){
    state.round++;
    state.slots = new Array(SLOTS).fill(null);
    state.ready = [false,false];
    state.picked = null;
    state.simIndex = 0;
    state.focus = null;
    state.roundResult = null;
    state.phase = 'stage';
    log('');
    log('Round ' + state.round + ' — slot 1 belongs to ' + pname(slotOwner(0)) + '.', COLOR.text);
  }

  function newMatch(){
    state.round = 1;
    state.wins = [0,0];
    state.slots = new Array(SLOTS).fill(null);
    state.ready = [false,false];
    state.picked = null;
    state.simIndex = 0;
    state.focus = null;
    state.roundResult = null;
    state.matchWinner = null;
    state.phase = 'stage';
    state.log = [];
    log('Both sides stage in secret, then the sequence resolves 1 through 10.', COLOR.textDim);
    log('Round 1 — slot 1 belongs to ' + pname(slotOwner(0)) + '.', COLOR.text);
  }

  function tryStartSim(){
    if(state.ready[0] && state.ready[1]){
      state.phase = 'sim';
      state.simIndex = 0;
      state.picked = null;
      log('Both sides are ready. The field resolves.', COLOR.text);
    }
  }

  // ---------- staging actions ----------
  function placeAt(i){
    if(state.phase!=='stage') return;
    const owner = slotOwner(i);
    if(state.ready[owner]) return;      // locked in
    if(state.slots[i]){                 // click a staged unit to pull it back
      state.slots[i] = null;
      return;
    }
    if(!state.picked) return;
    state.slots[i] = makeUnit(state.picked, owner, i);
  }
  function toggleReady(p){
    if(state.phase!=='stage') return;
    if(!state.ready[p] && stagedCount(p)===0) return; // must field at least one unit
    state.ready[p] = !state.ready[p];
    tryStartSim();
  }

  // ---------- drawing helpers ----------
  function rr(x,y,w,h,r){
    if(typeof r==='number') r={tl:r,tr:r,br:r,bl:r};
    ctx.beginPath();
    ctx.moveTo(x+r.tl,y);
    ctx.lineTo(x+w-r.tr,y);
    ctx.arcTo(x+w,y,x+w,y+r.tr,r.tr);
    ctx.lineTo(x+w,y+h-r.br);
    ctx.arcTo(x+w,y+h,x+w-r.br,y+h,r.br);
    ctx.lineTo(x+r.bl,y+h);
    ctx.arcTo(x,y+h,x,y+h-r.bl,r.bl);
    ctx.lineTo(x,y+r.tl);
    ctx.arcTo(x,y,x+r.tl,y,r.tl);
    ctx.closePath();
  }
  function wrapText(text, x, y, maxWidth, lineHeight, maxLines, align){
    align = align || 'center';
    const words = text.split(' ');
    let line = '', lines = [];
    for(let i=0;i<words.length;i++){
      const test = line ? line+' '+words[i] : words[i];
      if(ctx.measureText(test).width > maxWidth && line){ lines.push(line); line = words[i]; }
      else line = test;
    }
    lines.push(line);
    if(lines.length>maxLines){
      lines = lines.slice(0,maxLines);
      let last = lines[maxLines-1];
      while(ctx.measureText(last+'…').width > maxWidth && last.length>1) last = last.slice(0,-1);
      lines[maxLines-1] = last+'…';
    }
    ctx.textAlign = align;
    lines.forEach((l,i)=> ctx.fillText(l, x, y + i*lineHeight));
    return lines.length;
  }

  function glyphPath(type, cx, cy, s){
    ctx.beginPath();
    switch(type){
      case 'melee':
        ctx.moveTo(cx, cy-s); ctx.lineTo(cx+s*0.55, cy+s*0.7); ctx.lineTo(cx, cy+s*0.35); ctx.lineTo(cx-s*0.55, cy+s*0.7); ctx.closePath();
        break;
      case 'guard':
        ctx.moveTo(cx, cy-s); ctx.lineTo(cx+s*0.8, cy-s*0.45); ctx.lineTo(cx+s*0.8, cy+s*0.25); ctx.quadraticCurveTo(cx+s*0.8, cy+s*0.9, cx, cy+s*1.05);
        ctx.quadraticCurveTo(cx-s*0.8, cy+s*0.9, cx-s*0.8, cy+s*0.25); ctx.lineTo(cx-s*0.8, cy-s*0.45); ctx.closePath();
        break;
      case 'arcane':
        ctx.moveTo(cx, cy-s*1.05); ctx.quadraticCurveTo(cx+s*0.85, cy-s*0.1, cx, cy+s*1.0); ctx.quadraticCurveTo(cx-s*0.5, cy+s*0.2, cx, cy-s*1.05);
        break;
      case 'sacred':
        ctx.moveTo(cx-s*0.22, cy-s); ctx.lineTo(cx+s*0.22, cy-s); ctx.lineTo(cx+s*0.22, cy-s*0.22); ctx.lineTo(cx+s, cy-s*0.22);
        ctx.lineTo(cx+s, cy+s*0.22); ctx.lineTo(cx+s*0.22, cy+s*0.22); ctx.lineTo(cx+s*0.22, cy+s); ctx.lineTo(cx-s*0.22, cy+s);
        ctx.lineTo(cx-s*0.22, cy+s*0.22); ctx.lineTo(cx-s, cy+s*0.22); ctx.lineTo(cx-s, cy-s*0.22); ctx.lineTo(cx-s*0.22, cy-s*0.22);
        ctx.closePath();
        break;
      case 'hammer':
        ctx.moveTo(cx-s*0.9, cy-s*0.95); ctx.lineTo(cx+s*0.9, cy-s*0.95); ctx.lineTo(cx+s*0.9, cy-s*0.2);
        ctx.lineTo(cx+s*0.25, cy-s*0.2); ctx.lineTo(cx+s*0.25, cy+s*1.05); ctx.lineTo(cx-s*0.25, cy+s*1.05);
        ctx.lineTo(cx-s*0.25, cy-s*0.2); ctx.lineTo(cx-s*0.9, cy-s*0.2); ctx.closePath();
        break;
      case 'axe':
        ctx.moveTo(cx-s*0.15, cy-s*1.0); ctx.quadraticCurveTo(cx+s*1.0, cy-s*0.95, cx+s*0.85, cy+s*0.1);
        ctx.quadraticCurveTo(cx+s*0.3, cy-s*0.15, cx+s*0.12, cy+s*0.2);
        ctx.lineTo(cx+s*0.12, cy+s*1.05); ctx.lineTo(cx-s*0.18, cy+s*1.05); ctx.closePath();
        break;
    }
  }

  // ---------- layout ----------
  const M = 14;
  const RAIL_Y = 82, SLOT_W = 110, SLOT_H = 168, SLOT_GAP = 19;
  const BAND_Y = RAIL_Y + SLOT_H + 16;   // 266 — ready / sim controls
  const BAND_H = 40;
  const PANEL_Y = BAND_Y + BAND_H + 26;  // 332 — palette or scoreboard
  const PANEL_H = 132;
  const LOG_Y = PANEL_Y + PANEL_H + 14;  // 478
  const LOG_H = LH - LOG_Y - M;

  let hitRegions = [];
  function pushHit(x,y,w,h,fn){ hitRegions.push({x,y,w,h,fn}); }
  function pointIn(r,px,py){ return px>=r.x && px<=r.x+r.w && py>=r.y && py<=r.y+r.h; }
  function slotX(i){ return M + i*(SLOT_W+SLOT_GAP); }

  function drawButton(x,y,w,h,label,opts){
    opts = opts||{};
    const enabled = opts.enabled!==false;
    const accent = opts.accent || COLOR.mana;
    rr(x,y,w,h,8);
    ctx.fillStyle = enabled ? (opts.solid ? accent : COLOR.surface3) : COLOR.surface2;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = enabled ? accent : COLOR.lineSoft;
    ctx.stroke();
    ctx.font = "700 12.5px 'Manrope'";
    ctx.fillStyle = opts.solid && enabled ? '#0d1016' : (enabled ? COLOR.text : COLOR.textFaint);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x+w/2, y+h/2);
    if(enabled && opts.onClick) pushHit(x,y,w,h,opts.onClick);
  }

  function statPill(x,y,w,h,label,value,color){
    rr(x,y,w,h,5);
    ctx.fillStyle = COLOR.surface;
    ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = "700 11px 'JetBrains Mono'";
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label + ' ' + value, x+w/2, y+h/2+0.5);
  }

  // ---------- slot rendering ----------
  function drawSlotCard(i){
    const x = slotX(i), y = RAIL_Y, owner = slotOwner(i), col = pcolor(owner);
    const u = state.slots[i];
    const isActor  = state.focus && state.focus.actor === i;
    const isTarget = state.focus && state.focus.target === i;
    const resolved = state.phase!=='stage' && i < state.simIndex;

    // body
    rr(x, y, SLOT_W, SLOT_H, 9);
    ctx.fillStyle = u ? COLOR.surface2 : COLOR.surface;
    ctx.fill();
    if(!u){
      ctx.save();
      ctx.setLineDash([4,4]);
      ctx.strokeStyle = COLOR.lineSoft; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = isActor ? COLOR.text : (isTarget ? COLOR.danger : pdim(owner));
      ctx.lineWidth = isActor || isTarget ? 2.2 : 1.4;
      ctx.stroke();
    }

    // damage / heal flash
    if(u && u.flash > 0){
      rr(x, y, SLOT_W, SLOT_H, 9);
      ctx.fillStyle = 'rgba(226,96,79,' + (0.34*u.flash).toFixed(3) + ')';
      ctx.fill();
    }
    if(u && u.healFlash > 0){
      rr(x, y, SLOT_W, SLOT_H, 9);
      ctx.fillStyle = 'rgba(111,207,143,' + (0.30*u.healFlash).toFixed(3) + ')';
      ctx.fill();
    }

    // slot number strip
    rr(x, y, SLOT_W, 22, {tl:9,tr:9,br:0,bl:0});
    ctx.fillStyle = pdim(owner);
    ctx.fill();
    ctx.font = "700 12px 'JetBrains Mono'";
    ctx.fillStyle = col;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(String(i+1).padStart(2,'0'), x+8, y+12);
    ctx.font = "700 10px 'Manrope'";
    ctx.textAlign = 'right';
    ctx.fillStyle = col;
    ctx.fillText(owner===0 ? 'P1' : 'P2', x+SLOT_W-8, y+12);

    if(!u){
      ctx.font = "600 10.5px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(state.phase==='stage' ? 'empty' : '—', x+SLOT_W/2, y+SLOT_H/2+8);
      if(state.phase==='stage' && !state.ready[owner] && state.picked){
        pushHit(x,y,SLOT_W,SLOT_H, ()=>placeAt(i));
      }
      return;
    }

    ctx.save();
    if(u.dead) ctx.globalAlpha = 0.32;
    else if(resolved) ctx.globalAlpha = 0.62;

    // glyph
    const cx = x + SLOT_W/2, gy = y + 50;
    glyphPath(u.glyph, cx, gy, 15);
    ctx.fillStyle = col;
    ctx.globalAlpha *= 0.28;
    ctx.fill();
    ctx.globalAlpha = u.dead ? 0.32 : (resolved ? 0.62 : 1);
    ctx.strokeStyle = col; ctx.lineWidth = 1.6;
    ctx.stroke();

    // name
    ctx.font = "700 12px 'Manrope'";
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(u.name, cx, y+84);

    // stats
    const pw = 42;
    statPill(cx-pw-3, y+92, pw, 18, 'A', atkOf(u), u.buff ? COLOR.good : COLOR.textDim);
    statPill(cx+3,    y+92, pw, 18, 'H', u.hp,     missing(u) ? COLOR.danger : COLOR.textDim);

    // action reminder
    ctx.font = "500 9.5px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    wrapText(BY_KEY[u.key].action, cx, y+124, SLOT_W-14, 11, 3, 'center');
    ctx.restore();

    // status badges
    let bx = x+8;
    const badge = (text, color)=>{
      ctx.font = "700 9px 'JetBrains Mono'";
      const w = ctx.measureText(text).width + 10;
      rr(bx, y+SLOT_H-19, w, 14, 4);
      ctx.fillStyle = COLOR.surface; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, bx+w/2, y+SLOT_H-11.5);
      bx += w + 4;
    };
    if(u.dead) badge('DEAD', COLOR.danger);
    else {
      if(u.buff)   badge('+' + u.buff, COLOR.good);
      if(u.immune) badge('SHIELD', COLOR.mana);
      if(resolved && !u.dead) badge('DONE', COLOR.textFaint);
    }

    if(u.dead){
      ctx.strokeStyle = COLOR.danger; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x+18, y+32); ctx.lineTo(x+SLOT_W-18, y+SLOT_H-30);
      ctx.moveTo(x+SLOT_W-18, y+32); ctx.lineTo(x+18, y+SLOT_H-30);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if(state.phase==='stage' && !state.ready[owner]) pushHit(x,y,SLOT_W,SLOT_H, ()=>placeAt(i));
  }

  // ---------- header ----------
  function drawHeader(){
    ctx.font = "700 21px 'Spectral SC'";
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('FIELD DUEL', M, 32);

    ctx.font = "500 11px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText('simultaneous staging · slot order resolves 1 → 10', M+152, 33);

    // score
    const boxW = 190, bx = LW - M - boxW;
    ctx.font = "700 12px 'JetBrains Mono'";
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.textDim;
    ctx.fillText('BEST OF ' + (WINS_NEEDED*2-1), LW-M, 18);
    for(let p=0;p<2;p++){
      const y = 34 + p*17;
      ctx.textAlign = 'right';
      ctx.font = "700 12px 'Manrope'";
      ctx.fillStyle = pcolor(p);
      ctx.fillText(pname(p), LW-M-84, y);
      for(let k=0;k<WINS_NEEDED;k++){
        const dx = LW-M-72+k*16;
        ctx.beginPath();
        ctx.arc(dx, y, 5, 0, Math.PI*2);
        ctx.fillStyle = k < state.wins[p] ? pcolor(p) : COLOR.surface3;
        ctx.fill();
      }
    }

    // round + who owns slot 1
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = "700 15px 'Manrope'";
    ctx.fillStyle = COLOR.text;
    ctx.fillText('Round ' + state.round, LW/2 - 40, 26);
    ctx.font = "600 11px 'Manrope'";
    ctx.fillStyle = COLOR.textDim;
    ctx.fillText('slot 1 →', LW/2 + 22, 26);
    ctx.font = "700 11px 'Manrope'";
    ctx.fillStyle = pcolor(slotOwner(0));
    ctx.fillText(pname(slotOwner(0)), LW/2 + 84, 26);

    ctx.beginPath();
    ctx.moveTo(M, 64); ctx.lineTo(LW-M, 64);
    ctx.strokeStyle = COLOR.lineSoft; ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---------- control band ----------
  function drawBand(){
    if(state.phase==='stage'){
      for(let p=0;p<2;p++){
        const w = 230, h = BAND_H;
        const x = p===0 ? M : LW-M-w;
        const n = stagedCount(p);
        const ready = state.ready[p];
        drawButton(x, BAND_Y, w, h,
          ready ? pname(p) + ' — READY' : pname(p) + ' — ready (' + n + '/' + PER_SIDE + ')',
          { accent:pcolor(p), solid:ready, enabled:ready || n>0, onClick:()=>toggleReady(p) });
      }
      ctx.font = "600 12px 'Manrope'";
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const msg = state.picked
        ? 'Click one of ' + pname(0) + "'s or " + pname(1) + "'s empty slots to place the " + BY_KEY[state.picked].name + '.'
        : 'Pick a unit below, then click an empty slot. Click a staged unit to take it back.';
      ctx.fillText(msg, LW/2, BAND_Y + BAND_H/2);
      return;
    }

    if(state.phase==='sim'){
      drawButton(M, BAND_Y, 120, BAND_H, state.auto ? 'Pause' : 'Auto',
        { accent:COLOR.mana, onClick:()=>{ state.auto = !state.auto; } });
      drawButton(M+130, BAND_Y, 120, BAND_H, 'Step',
        { accent:COLOR.text, enabled:!state.auto, onClick:()=>stepSim() });
      ctx.font = "700 13px 'Manrope'";
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Resolving slot ' + Math.min(state.simIndex, SLOTS) + ' of ' + SLOTS, LW/2, BAND_Y+BAND_H/2);
      return;
    }

    if(state.phase==='roundEnd'){
      const r = state.roundResult;
      ctx.font = "700 15px 'Manrope'";
      ctx.fillStyle = r.winner===null ? COLOR.textDim : pcolor(r.winner);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(r.winner===null ? 'Round drawn' : pname(r.winner) + ' takes round ' + state.round, M, BAND_Y+BAND_H/2);
      ctx.font = "500 12px 'Manrope'";
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(r.why, M+240, BAND_Y+BAND_H/2);
      drawButton(LW-M-200, BAND_Y, 200, BAND_H, 'Stage round ' + (state.round+1),
        { accent:COLOR.mana, solid:true, onClick:nextRound });
      return;
    }

    if(state.phase==='matchEnd'){
      ctx.font = "700 17px 'Spectral SC'";
      ctx.fillStyle = pcolor(state.matchWinner);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(pname(state.matchWinner) + ' wins the match ' + state.wins[0] + '–' + state.wins[1], M, BAND_Y+BAND_H/2);
      drawButton(LW-M-200, BAND_Y, 200, BAND_H, 'New match',
        { accent:COLOR.mana, solid:true, onClick:newMatch });
    }
  }

  // ---------- palette (stage) ----------
  function drawPalette(){
    ctx.font = "700 11px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('ROSTER — both sides draw from the same six, duplicates allowed', M, PANEL_Y-14);

    const n = ROSTER.length, gap = 16;
    const w = Math.floor((LW - 2*M - (n-1)*gap) / n);
    ROSTER.forEach((t,i)=>{
      const x = M + i*(w+gap), y = PANEL_Y, h = PANEL_H;
      const sel = state.picked === t.key;
      rr(x,y,w,h,9);
      ctx.fillStyle = sel ? COLOR.surface3 : COLOR.surface2;
      ctx.fill();
      ctx.strokeStyle = sel ? COLOR.mana : COLOR.line;
      ctx.lineWidth = sel ? 2 : 1.2;
      ctx.stroke();

      glyphPath(t.glyph, x+26, y+26, 13);
      ctx.fillStyle = COLOR.mana; ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = COLOR.mana; ctx.lineWidth = 1.5; ctx.stroke();

      ctx.font = "700 13.5px 'Manrope'";
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(t.name, x+48, y+20);
      ctx.font = "700 11px 'JetBrains Mono'";
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(t.atk + ' ATK / ' + t.hp + ' HP', x+48, y+37);

      ctx.font = "500 10.5px 'Manrope'";
      ctx.fillStyle = COLOR.textDim;
      wrapText(t.action, x+12, y+66, w-24, 13, 4, 'left');

      pushHit(x,y,w,h, ()=>{ state.picked = sel ? null : t.key; });
    });
  }

  // ---------- scoreboard (sim / end) ----------
  function drawScoreboard(){
    ctx.font = "700 11px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('FIELD STATE', M, PANEL_Y-14);

    const w = (LW - 2*M - 16)/2;
    for(let p=0;p<2;p++){
      const x = M + p*(w+16), y = PANEL_Y, h = PANEL_H;
      rr(x,y,w,h,9);
      ctx.fillStyle = COLOR.surface2; ctx.fill();
      ctx.strokeStyle = pdim(p); ctx.lineWidth = 1.4; ctx.stroke();

      const list = state.slots.filter(u=>u && u.owner===p);
      const live = list.filter(u=>!u.dead);
      const hp = live.reduce((s,u)=>s+u.hp,0);

      ctx.font = "700 14px 'Manrope'";
      ctx.fillStyle = pcolor(p);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(pname(p), x+14, y+22);
      ctx.font = "700 12px 'JetBrains Mono'";
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign = 'right';
      ctx.fillText(live.length + '/' + list.length + ' alive · ' + hp + ' HP', x+w-14, y+22);

      ctx.beginPath();
      ctx.moveTo(x+14, y+36); ctx.lineTo(x+w-14, y+36);
      ctx.strokeStyle = COLOR.lineSoft; ctx.lineWidth = 1; ctx.stroke();

      list.forEach((u,k)=>{
        const ly = y+54 + k*17;
        if(ly > y+h-8) return;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.font = "600 11px 'JetBrains Mono'";
        ctx.fillStyle = u.dead ? COLOR.textFaint : COLOR.textDim;
        ctx.fillText(String(u.slot+1).padStart(2,'0'), x+14, ly);
        ctx.font = "600 12px 'Manrope'";
        ctx.fillStyle = u.dead ? COLOR.textFaint : COLOR.text;
        ctx.fillText(u.name, x+42, ly);
        ctx.textAlign = 'right';
        ctx.font = "700 11px 'JetBrains Mono'";
        if(u.dead){ ctx.fillStyle = COLOR.danger; ctx.fillText('dead', x+w-14, ly); }
        else {
          ctx.fillStyle = missing(u) ? COLOR.danger : COLOR.textDim;
          ctx.fillText(atkOf(u) + ' / ' + u.hp + (u.buff ? '  +' + u.buff : ''), x+w-14, ly);
        }
      });
    }
  }

  // ---------- log ----------
  function drawLog(){
    rr(M, LOG_Y, LW-2*M, LOG_H, 9);
    ctx.fillStyle = COLOR.surface; ctx.fill();
    ctx.strokeStyle = COLOR.lineSoft; ctx.lineWidth = 1; ctx.stroke();

    const lineH = 15.5;
    const rows = Math.floor((LOG_H - 20) / lineH);
    const lines = state.log.slice(-rows);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    lines.forEach((l,i)=>{
      ctx.font = l.text.startsWith('    ') ? "500 11.5px 'Manrope'" : "600 12px 'Manrope'";
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, M+14, LOG_Y+16+i*lineH);
    });
  }

  // ---------- render ----------
  function render(){
    hitRegions = [];
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0,0,LW,LH);

    drawHeader();
    for(let i=0;i<SLOTS;i++) drawSlotCard(i);
    drawBand();
    if(state.phase==='stage') drawPalette(); else drawScoreboard();
    drawLog();
  }

  // ---------- input ----------
  function toLogical(evt){
    const r = canvas.getBoundingClientRect();
    return { x:(evt.clientX-r.left) * (LW/r.width), y:(evt.clientY-r.top) * (LH/r.height) };
  }
  canvas.addEventListener('click', e=>{
    const p = toLogical(e);
    for(let i=hitRegions.length-1;i>=0;i--){
      if(pointIn(hitRegions[i], p.x, p.y)){ hitRegions[i].fn(); return; }
    }
  });
  canvas.addEventListener('mousemove', e=>{
    const p = toLogical(e);
    canvas.style.cursor = hitRegions.some(r=>pointIn(r,p.x,p.y)) ? 'pointer' : 'default';
  });
  window.addEventListener('keydown', e=>{
    if(e.key===' '){ e.preventDefault(); if(state.phase==='sim') stepSim(); }
  });

  // ---------- loop ----------
  let lastStep = 0;
  function frame(ts){
    state.slots.forEach(u=>{
      if(!u) return;
      if(REDUCE_MOTION){ u.flash = 0; u.healFlash = 0; return; }
      if(u.flash>0)     u.flash     = Math.max(0, u.flash - 0.055);
      if(u.healFlash>0) u.healFlash = Math.max(0, u.healFlash - 0.055);
    });
    if(state.phase==='sim' && state.auto && ts - lastStep > STEP_MS){
      lastStep = ts;
      stepSim();
    }
    render();
    requestAnimationFrame(frame);
  }

  // debug hook for headless testing
  window.__fd = { state, stepSim, makeUnit, placeAt, toggleReady, nextRound, atkOf, ROSTER, slotOwner, render, hits:()=>hitRegions };

  newMatch();
  requestAnimationFrame(frame);
})();
