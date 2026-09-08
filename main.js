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
    const scale = Math.min(1300, window.innerWidth - 40) / LW;
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

  // ---------- card templates ----------
  const TEMPLATES = {
    warrior: { key:'warrior', name:'Vanguard',     cost:50,  atk:2, hp:2, type:'melee',  glyph:'blade',
      ability:{ name:'Rally Cry', cost:25, desc:'+1 Atk until your next turn', target:'none',    effect:'rally' } },
    tank:    { key:'tank',    name:'Bastion',       cost:75,  atk:1, hp:5, type:'guard',  glyph:'shield',
      ability:{ name:'Mend',      cost:50, desc:'Heal 2 on a friendly unit',    target:'friendly', effect:'mend'  } },
    mage:    { key:'mage',    name:'Cinderwright',  cost:75,  atk:3, hp:2, type:'arcane', glyph:'flame',
      ability:{ name:'Scorch',    cost:50, desc:'Deal 2 to an enemy unit or general', target:'enemy', effect:'scorch'} },
    healer:  { key:'healer',  name:'Wellspring',    cost:50,  atk:2, hp:3, type:'sacred', glyph:'drop',
      ability:{ name:'Soothe',    cost:25, desc:'Heal 1 on itself',             target:'none',    effect:'soothe'} },
    brute:   { key:'brute',   name:'Ironclad',      cost:100, atk:4, hp:4, type:'brute',  glyph:'spike',
      ability:{ name:'Rage',      cost:50, desc:'+2 Atk, permanently',          target:'none',    effect:'rage'  } }
  };
  const TYPE_COLOR = { melee:COLOR.p1, guard:COLOR.mana, arcane:COLOR.p2, sacred:COLOR.good, brute:COLOR.danger };

  let uidCounter = 1;
  function makeCardInstance(tplKey){
    const t = TEMPLATES[tplKey];
    return { iid:'c'+(uidCounter++), key:t.key, name:t.name, cost:t.cost, atk:t.atk, hp:t.hp, type:t.type, glyph:t.glyph, ability:t.ability };
  }
  function buildDeck(){
    const deck = [];
    Object.keys(TEMPLATES).forEach(k=>{ for(let i=0;i<3;i++) deck.push(makeCardInstance(k)); });
    // shuffle
    for(let i=deck.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [deck[i],deck[j]] = [deck[j],deck[i]];
    }
    return deck;
  }

  // ---------- game state ----------
  const MAX_BOARD = 6, MAX_HAND = 8, DECK_SIZE = 15, MANA_REGEN = 100, DRAW_COST = 25, GENERAL_HP = 30;

  function makePlayer(idx, name, color, dim){
    return {
      idx, name, color, dim,
      general:{ hp:GENERAL_HP, maxHp:GENERAL_HP },
      mana:0,
      deck:buildDeck(),
      hand:[],
      board:[]
    };
  }

  const state = {
    players:[
      makePlayer(0,'Player 1',COLOR.p1,COLOR.p1dim),
      makePlayer(1,'Player 2',COLOR.p2,COLOR.p2dim)
    ],
    turnPlayer:0,
    turnNumber:1,
    selection:null,      // {kind:'hand'|'unit', owner, id}
    pending:null,        // {kind:'ability'|'attack', owner, unitId, ability?}
    log:[],
    gameOver:null
  };

  function log(msg){
    state.log.push(msg);
    if(state.log.length>60) state.log.shift();
  }

  function opponentOf(idx){ return state.players[1-idx]; }
  function activePlayer(){ return state.players[state.turnPlayer]; }
  function findUnit(ownerIdx, uid){ return state.players[ownerIdx].board.find(u=>u.uid===uid); }
  function totalAtk(u){ return u.atk + u.tempAtk; }

  function dealOpeningHand(p){
    for(let i=0;i<3;i++){ const c = p.deck.pop(); if(c) p.hand.push(c); }
  }

  function startTurn(idx){
    const p = state.players[idx];
    p.mana += MANA_REGEN;
    p.board.forEach(u=>{ u.sickness=false; u.attacked=false; u.tempAtk=0; });
    log(`${p.name}'s turn begins — gains ${MANA_REGEN} mana (now ${p.mana}).`);
  }

  function initGame(){
    state.players[0] = makePlayer(0,'Player 1',COLOR.p1,COLOR.p1dim);
    state.players[1] = makePlayer(1,'Player 2',COLOR.p2,COLOR.p2dim);
    state.players.forEach(dealOpeningHand);
    state.turnPlayer = 0;
    state.turnNumber = 1;
    state.selection = null;
    state.pending = null;
    state.log = [];
    state.gameOver = null;
    startTurn(0);
    log('The ledger opens. Player 1 moves first.');
  }

  // ---------- actions ----------
  function clearTransient(){ state.pending=null; }

  function selectHand(ownerIdx, iid){
    if(state.pending) { state.pending=null; return; }
    if(state.selection && state.selection.kind==='hand' && state.selection.id===iid){ state.selection=null; return; }
    state.selection = { kind:'hand', owner:ownerIdx, id:iid };
  }
  function selectUnit(ownerIdx, uid){
    if(state.pending) { state.pending=null; return; }
    if(state.selection && state.selection.kind==='unit' && state.selection.id===uid){ state.selection=null; return; }
    state.selection = { kind:'unit', owner:ownerIdx, id:uid };
  }

  function playSelectedCard(){
    const sel = state.selection;
    if(!sel || sel.kind!=='hand') return;
    const p = state.players[sel.owner];
    if(sel.owner!==state.turnPlayer) return;
    const idx = p.hand.findIndex(c=>c.iid===sel.id);
    if(idx===-1) return;
    const card = p.hand[idx];
    if(p.mana < card.cost) return;
    if(p.board.length >= MAX_BOARD) return;
    p.mana -= card.cost;
    p.hand.splice(idx,1);
    p.board.push({
      uid:'u'+(uidCounter++), key:card.key, name:card.name, type:card.type, glyph:card.glyph,
      atk:card.atk, baseAtk:card.atk, hp:card.hp, maxHp:card.hp, tempAtk:0,
      ability:card.ability, sickness:true, attacked:false
    });
    log(`${p.name} deploys ${card.name} (${card.cost} mana).`);
    state.selection = null;
  }

  function drawForPlayer(idx){
    const p = state.players[idx];
    if(idx!==state.turnPlayer) return;
    if(p.mana < DRAW_COST) return;
    if(p.hand.length >= MAX_HAND) return;
    if(p.deck.length === 0) return;
    p.mana -= DRAW_COST;
    const card = p.deck.pop();
    p.hand.push(card);
    log(`${p.name} draws ${card.name} (${DRAW_COST} mana).`);
  }

  function beginAbility(ownerIdx, uid){
    const unit = findUnit(ownerIdx, uid);
    if(!unit) return;
    const p = state.players[ownerIdx];
    if(ownerIdx!==state.turnPlayer || p.mana < unit.ability.cost) return;
    if(unit.ability.target==='none'){
      resolveAbility(ownerIdx, uid, null);
    } else {
      state.pending = { kind:'ability', owner:ownerIdx, unitId:uid };
    }
  }

  function resolveAbility(ownerIdx, uid, target){
    const p = state.players[ownerIdx];
    const unit = findUnit(ownerIdx, uid);
    if(!unit) return;
    const ab = unit.ability;
    if(p.mana < ab.cost) return;
    p.mana -= ab.cost;
    switch(ab.effect){
      case 'rally': unit.tempAtk += 1; log(`${p.name}'s ${unit.name} rallies (+1 Atk).`); break;
      case 'soothe': unit.hp += 1; log(`${p.name}'s ${unit.name} soothes itself (+1 HP).`); break;
      case 'rage': unit.atk += 2; log(`${p.name}'s ${unit.name} rages (+2 Atk, permanent).`); break;
      case 'mend': {
        const t = target && target.kind==='unit' ? findUnit(target.owner, target.uid) : null;
        if(t){ t.hp += 2; log(`${p.name}'s ${unit.name} mends ${t.name} (+2 HP).`); }
        break;
      }
      case 'scorch': {
        if(target && target.kind==='face'){
          const enemy = state.players[target.owner];
          enemy.general.hp -= 2;
          log(`${p.name}'s ${unit.name} scorches ${enemy.name}'s general for 2.`);
          checkWin();
        } else if(target && target.kind==='unit'){
          const t = findUnit(target.owner, target.uid);
          if(t){
            t.hp -= 2;
            log(`${p.name}'s ${unit.name} scorches ${t.name} for 2.`);
            killIfDead(target.owner, t);
          }
        }
        break;
      }
    }
    state.pending = null;
    state.selection = null;
  }

  function resolveAbilityTarget(kind, owner, uid){
    if(!state.pending || state.pending.kind!=='ability') return;
    resolveAbility(state.pending.owner, state.pending.unitId, { kind, owner, uid });
  }

  function beginAttack(ownerIdx, uid){
    const unit = findUnit(ownerIdx, uid);
    if(!unit) return;
    if(ownerIdx!==state.turnPlayer || unit.sickness || unit.attacked) return;
    state.pending = { kind:'attack', owner:ownerIdx, unitId:uid };
  }

  function killIfDead(ownerIdx, unit){
    if(unit.hp<=0){
      const p = state.players[ownerIdx];
      const i = p.board.findIndex(u=>u.uid===unit.uid);
      if(i!==-1) p.board.splice(i,1);
      log(`${unit.name} falls.`);
      if(state.selection && state.selection.kind==='unit' && state.selection.id===unit.uid) state.selection=null;
    }
  }

  function resolveAttack(targetKind, targetOwner, targetUid){
    if(!state.pending || state.pending.kind!=='attack') return;
    const { owner, unitId } = state.pending;
    const attacker = findUnit(owner, unitId);
    if(!attacker) { state.pending=null; return; }
    const atkP = state.players[owner];
    if(targetKind==='face'){
      const enemy = state.players[targetOwner];
      enemy.general.hp -= totalAtk(attacker);
      log(`${atkP.name}'s ${attacker.name} strikes ${enemy.name}'s general for ${totalAtk(attacker)}.`);
      attacker.attacked = true;
      checkWin();
    } else {
      const defender = findUnit(targetOwner, targetUid);
      if(defender){
        const a = totalAtk(attacker), d = totalAtk(defender);
        defender.hp -= a;
        attacker.hp -= d;
        log(`${atkP.name}'s ${attacker.name} clashes with ${state.players[targetOwner].name}'s ${defender.name} (${a} vs ${d}).`);
        attacker.attacked = true;
        killIfDead(targetOwner, defender);
        killIfDead(owner, attacker);
      }
    }
    state.pending = null;
    state.selection = null;
  }

  function checkWin(){
    state.players.forEach((p,i)=>{
      if(p.general.hp<=0 && !state.gameOver){
        p.general.hp = 0;
        state.gameOver = { winner: 1-i };
        log(`${state.players[1-i].name} claims the ledger.`);
      }
    });
  }

  function endTurn(){
    if(state.gameOver) return;
    state.selection = null;
    state.pending = null;
    const finished = state.turnPlayer;
    state.turnPlayer = 1-finished;
    if(state.turnPlayer===0) state.turnNumber++;
    startTurn(state.turnPlayer);
  }

  initGame();

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
      if(ctx.measureText(test).width > maxWidth && line){
        lines.push(line); line = words[i];
      } else line = test;
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
      case 'brute':
        for(let i=0;i<6;i++){
          const a = -Math.PI/2 + i*(Math.PI*2/6);
          const r1 = s, r2 = s*0.42;
          const a2 = a + Math.PI/6;
          if(i===0) ctx.moveTo(cx+Math.cos(a)*r1, cy+Math.sin(a)*r1); else ctx.lineTo(cx+Math.cos(a)*r1, cy+Math.sin(a)*r1);
          ctx.lineTo(cx+Math.cos(a2)*r2, cy+Math.sin(a2)*r2);
        }
        ctx.closePath();
        break;
    }
  }

  function manaCrystal(x,y,s, filled){
    ctx.beginPath();
    ctx.moveTo(x, y-s); ctx.lineTo(x+s*0.72, y-s*0.15); ctx.lineTo(x+s*0.44, y+s); ctx.lineTo(x-s*0.44, y+s); ctx.lineTo(x-s*0.72, y-s*0.15);
    ctx.closePath();
    ctx.fillStyle = filled ? COLOR.mana : 'rgba(82,214,201,0.12)';
    ctx.fill();
    ctx.strokeStyle = filled ? COLOR.mana : COLOR.manaDim;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // ---------- layout constants ----------
  const BOARD_X0 = 14, BOARD_W = 986;
  const SB_X = 1012, SB_W = LW - SB_X - 14;
  const CARD_W = 84, CARD_H = 100, SLOT_GAP = 10;

  let hitRegions = [];
  function pushHit(x,y,w,h,fn){ hitRegions.push({x,y,w,h,fn}); }
  function pointIn(r,px,py){ return px>=r.x && px<=r.x+r.w && py>=r.y && py<=r.y+r.h; }

  function isValidAbilityTarget(kind, owner){
    if(!state.pending || state.pending.kind!=='ability') return false;
    const caster = findUnit(state.pending.owner, state.pending.unitId);
    if(!caster) return false;
    const need = caster.ability.target;
    if(need==='friendly') return kind==='unit' && owner===state.pending.owner;
    if(need==='enemy') return (kind==='unit' && owner!==state.pending.owner) || (kind==='face' && owner!==state.pending.owner);
    return false;
  }
  function isValidAttackTarget(kind, owner){
    if(!state.pending || state.pending.kind!=='attack') return false;
    return owner !== state.pending.owner;
  }

  function drawButton(x,y,w,h,label,opts){
    opts = opts||{};
    const enabled = opts.enabled!==false;
    const accent = opts.accent || COLOR.mana;
    const sub = opts.sub;
    rr(x,y,w,h,8);
    ctx.fillStyle = enabled ? (opts.solid? accent : COLOR.surface3) : COLOR.surface2;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = enabled ? accent : COLOR.lineSoft;
    ctx.stroke();
    ctx.font = "700 12.5px 'Manrope'";
    ctx.fillStyle = opts.solid && enabled ? '#0d1016' : (enabled? COLOR.text : COLOR.textFaint);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x+w/2, y + (sub? h/2-7 : h/2));
    if(sub){
      ctx.font = "600 10px 'JetBrains Mono'";
      ctx.fillStyle = opts.solid && enabled ? 'rgba(13,16,22,0.75)' : COLOR.textDim;
      ctx.fillText(sub, x+w/2, y+h/2+9);
    }
    return {x,y,w,h,enabled};
  }

  // ---------- card / unit tile drawing ----------
  function drawCardTile(x,y,card,opts){
    opts = opts||{};
    const selected = opts.selected, dim = opts.dim, playable = opts.playable!==false;
    rr(x,y,CARD_W,CARD_H,9);
    ctx.fillStyle = COLOR.surface2;
    ctx.fill();
    ctx.lineWidth = selected ? 2.4 : 1.3;
    ctx.strokeStyle = selected ? COLOR.mana : (playable ? COLOR.line : COLOR.lineSoft);
    ctx.stroke();
    if(dim){ ctx.save(); ctx.globalAlpha=0.42; }

    // name
    ctx.font = "600 11px 'Spectral SC'";
    ctx.fillStyle = COLOR.text;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    wrapText(card.name, x+CARD_W/2, y+16, CARD_W-14, 12, 2, 'center');

    // glyph
    ctx.fillStyle = TYPE_COLOR[card.type];
    glyphPath(card.type, x+CARD_W/2, y+48, 14);
    ctx.fill();

    // stats row: attack — cost — health
    const statY = y+CARD_H-13;
    ctx.font = "700 12px 'JetBrains Mono'";
    ctx.textAlign='left';
    ctx.fillStyle = COLOR.p1;
    ctx.fillText('⚔'+card.atk, x+9, statY);
    ctx.textAlign='right';
    ctx.fillStyle = COLOR.danger;
    ctx.fillText(card.hp+'♥', x+CARD_W-9, statY);

    manaCrystal(x+CARD_W/2,statY,11, true);
    ctx.font = (String(card.cost).length>2 ? "700 9px" : "700 11px") + " 'JetBrains Mono'";
    ctx.fillStyle = '#0d1016';
    ctx.textAlign='center';
    ctx.fillText(card.cost, x+CARD_W/2, statY+1);

    if(dim) ctx.restore();
  }

  function drawUnitTile(x,y,unit,opts){
    opts = opts||{};
    const selected=opts.selected, canActThis=opts.canAct, isValidTarget=opts.isValidTarget, faded=opts.faded;
    rr(x,y,CARD_W,CARD_H,9);
    ctx.fillStyle = COLOR.surface2;
    ctx.fill();
    let strokeColor = COLOR.line;
    let lw = 1.3;
    if(isValidTarget){ strokeColor = opts.targetAccent || COLOR.good; lw=2.4; }
    else if(selected){ strokeColor = COLOR.mana; lw=2.4; }
    ctx.lineWidth = lw;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();

    if(isValidTarget && !REDUCE_MOTION){
      const pulse = 0.15 + 0.15*Math.sin(performance.now()/280);
      ctx.save();
      rr(x,y,CARD_W,CARD_H,9);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = opts.targetAccent || COLOR.good;
      ctx.fill();
      ctx.restore();
    }

    if(faded){ ctx.save(); ctx.globalAlpha=0.5; }

    ctx.font = "600 11px 'Spectral SC'";
    ctx.fillStyle = COLOR.text;
    wrapText(unit.name, x+CARD_W/2, y+15, CARD_W-14, 12, 2, 'center');

    ctx.fillStyle = TYPE_COLOR[unit.type];
    glyphPath(unit.type, x+CARD_W/2, y+52, 15);
    ctx.fill();

    ctx.font = "700 12px 'JetBrains Mono'";
    ctx.textAlign='left';
    ctx.fillStyle = totalAtk(unit)>unit.atk ? COLOR.good : COLOR.p1;
    ctx.fillText('⚔'+totalAtk(unit), x+9, y+CARD_H-11);
    ctx.textAlign='right';
    ctx.fillStyle = COLOR.danger;
    ctx.fillText(unit.hp+'♥', x+CARD_W-9, y+CARD_H-11);

    if(unit.sickness){
      ctx.font = "600 8.5px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.textAlign='center';
      ctx.fillText('resting', x+CARD_W/2, y+CARD_H-24);
    } else if(unit.attacked){
      ctx.font = "600 8.5px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.textAlign='center';
      ctx.fillText('spent', x+CARD_W/2, y+CARD_H-24);
    } else if(canActThis){
      ctx.font = "600 8.5px 'Manrope'";
      ctx.fillStyle = COLOR.good;
      ctx.textAlign='center';
      ctx.fillText('ready', x+CARD_W/2, y+CARD_H-24);
    }

    if(faded) ctx.restore();
  }

  function drawEmptySlot(x,y){
    rr(x,y,CARD_W,CARD_H,9);
    ctx.setLineDash([4,4]);
    ctx.lineWidth=1.2;
    ctx.strokeStyle = COLOR.lineSoft;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---------- row layout ----------
  function rowOfCards(items, y, drawFn){
    const n = items.length;
    const totalW = n*CARD_W + Math.max(0,n-1)*SLOT_GAP;
    const x0 = BOARD_X0 + (BOARD_W-totalW)/2;
    items.forEach((it,i)=> drawFn(x0 + i*(CARD_W+SLOT_GAP), y, it));
  }
  function rowOfSlots(y, n, drawFn){
    const totalW = n*CARD_W + (n-1)*SLOT_GAP;
    const x0 = BOARD_X0 + (BOARD_W-totalW)/2;
    for(let i=0;i<n;i++) drawFn(x0 + i*(CARD_W+SLOT_GAP), y, i);
  }

  function sectionLabel(text, x, y, color){
    ctx.font = "700 10.5px 'Manrope'";
    ctx.fillStyle = color || COLOR.textFaint;
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.save();
    ctx.letterSpacing = '0.08em';
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.restore();
  }

  // ---------- main render ----------
  const HAND_Y_TOP = 34, BOARD_Y_TOP = 168, HAND_Y_BOT = 522, BOARD_Y_BOT = 372;
  const CENTER_Y = 292;

  function render(){
    hitRegions = [];
    ctx.clearRect(0,0,LW,LH);
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0,0,LW,LH);

    drawPlayerRow(1, HAND_Y_TOP, BOARD_Y_TOP, false);
    drawCenterStrip();
    drawPlayerRow(0, HAND_Y_BOT, BOARD_Y_BOT, true);
    drawSidebar();

    if(state.gameOver) drawGameOver();

    requestAnimationFrame(render);
  }

  function drawPlayerRow(idx, handY, boardY, isBottom){
    const p = state.players[idx];
    const isTurn = state.turnPlayer===idx && !state.gameOver;

    sectionLabel(p.name+' — hand', BOARD_X0, handY-10, p.color);
    rowOfCards(p.hand, handY, (x,y,card)=>{
      const sel = state.selection && state.selection.kind==='hand' && state.selection.owner===idx && state.selection.id===card.iid;
      const playable = isTurn && p.mana>=card.cost && p.board.length<MAX_BOARD;
      drawCardTile(x,y,card,{selected:sel, playable, dim: !isTurn && !sel});
      if(!state.pending){
        pushHit(x,y,CARD_W,CARD_H,()=> selectHand(idx, card.iid));
      }
    });

    sectionLabel(p.name+' — board', BOARD_X0, boardY-10, p.color);
    rowOfSlots(boardY, MAX_BOARD, (x,y,i)=>{
      const unit = p.board[i];
      if(!unit){ drawEmptySlot(x,y); return; }
      const sel = state.selection && state.selection.kind==='unit' && state.selection.owner===idx && state.selection.id===unit.uid;
      const validAbilityTarget = isValidAbilityTarget('unit', idx);
      const validAttackTarget = isValidAttackTarget('unit', idx);
      const isValidTarget = validAbilityTarget || validAttackTarget;
      const canActThis = isTurn && !unit.sickness && !unit.attacked;
      drawUnitTile(x,y,unit,{
        selected:sel, canAct:canActThis, isValidTarget,
        targetAccent: validAttackTarget ? COLOR.danger : COLOR.good,
        faded: state.pending && !isValidTarget
      });
      if(state.pending){
        if(isValidTarget){
          pushHit(x,y,CARD_W,CARD_H,()=>{
            if(state.pending.kind==='ability') resolveAbilityTarget('unit', idx, unit.uid);
            else resolveAttack('unit', idx, unit.uid);
          });
        }
      } else {
        pushHit(x,y,CARD_W,CARD_H,()=> selectUnit(idx, unit.uid));
      }
    });
  }

  function drawCenterStrip(){
    const y = CENTER_Y, h = 44;
    rr(BOARD_X0,y,BOARD_W,h,10);
    ctx.fillStyle = COLOR.surface;
    ctx.fill();
    ctx.strokeStyle = COLOR.lineSoft;
    ctx.lineWidth=1;
    ctx.stroke();

    ctx.textBaseline='middle';
    if(state.pending){
      const p = state.players[state.pending.owner];
      const unit = findUnit(state.pending.owner, state.pending.unitId);
      const label = state.pending.kind==='ability'
        ? `Choose a target for ${unit? unit.ability.name : 'the ability'}`
        : `Choose what ${unit? unit.name : 'the unit'} attacks`;
      ctx.font = "700 13px 'Manrope'";
      ctx.fillStyle = COLOR.text;
      ctx.textAlign='left';
      ctx.fillText(label, BOARD_X0+18, y+h/2);
    } else if(!state.gameOver) {
      const p = activePlayer();
      ctx.font = "600 12px 'Spectral SC'";
      ctx.fillStyle = p.color;
      ctx.textAlign='left';
      ctx.fillText(`TURN ${state.turnNumber}`, BOARD_X0+18, y+h/2-8);
      ctx.font = "700 13px 'Manrope'";
      ctx.fillStyle = COLOR.text;
      ctx.fillText(`${p.name}'s move`, BOARD_X0+18, y+h/2+9);
    } else {
      ctx.font = "700 13px 'Manrope'";
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign='left';
      ctx.fillText('The ledger has closed.', BOARD_X0+18, y+h/2);
    }

    // End turn / cancel button
    if(state.pending){
      const r = drawButton(BOARD_X0+BOARD_W-130, y+7, 116, h-14, 'Cancel', {accent:COLOR.danger});
      pushHit(r.x,r.y,r.w,r.h,()=>{ state.pending=null; });
    } else {
      const enabled = !state.gameOver;
      const r = drawButton(BOARD_X0+BOARD_W-150, y+7, 136, h-14, 'End Turn →', {accent:activePlayer().color, solid:true, enabled});
      if(enabled) pushHit(r.x,r.y,r.w,r.h,endTurn);
    }
  }

  // ---------- sidebar ----------
  function drawStatusPanel(x,y,w,h,idx){
    const p = state.players[idx];
    const isTurn = state.turnPlayer===idx && !state.gameOver;
    rr(x,y,w,h,10);
    ctx.fillStyle = COLOR.surface;
    ctx.fill();
    ctx.lineWidth = isTurn? 1.6:1;
    ctx.strokeStyle = isTurn? p.color : COLOR.lineSoft;
    ctx.stroke();

    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.font = "700 13px 'Spectral SC'";
    ctx.fillStyle = p.color;
    ctx.fillText(p.name.toUpperCase(), x+14, y+22);

    // general hp bar
    const barX=x+14, barY=y+32, barW=w-90, barH=8;
    rr(barX,barY,barW,barH,4); ctx.fillStyle=COLOR.surface3; ctx.fill();
    const pct = Math.max(0,p.general.hp)/p.general.maxHp;
    rr(barX,barY,barW*pct,barH,4); ctx.fillStyle=COLOR.danger; ctx.fill();
    ctx.font="700 11px 'JetBrains Mono'";
    ctx.fillStyle=COLOR.text;
    ctx.textAlign='right';
    ctx.fillText(Math.max(0,p.general.hp)+' / '+p.general.maxHp, x+w-14, y+22);

    // face as attack target
    if(isValidAttackTarget('face', idx)){
      const pulse = REDUCE_MOTION? 0.22 : 0.15+0.15*Math.sin(performance.now()/280);
      rr(barX-4,barY-4,barW+8,barH+8,6);
      ctx.globalAlpha=pulse; ctx.fillStyle=COLOR.danger; ctx.fill(); ctx.globalAlpha=1;
      rr(barX-4,barY-4,barW+8,barH+8,6);
      ctx.strokeStyle=COLOR.danger; ctx.lineWidth=1.6; ctx.stroke();
      pushHit(barX-4,barY-4,barW+8,barH+8,()=> resolveAttack('face', idx, null));
    } else if(isValidAbilityTarget('face', idx)){
      const pulse = REDUCE_MOTION? 0.22 : 0.15+0.15*Math.sin(performance.now()/280);
      rr(barX-4,barY-4,barW+8,barH+8,6);
      ctx.globalAlpha=pulse; ctx.fillStyle=COLOR.good; ctx.fill(); ctx.globalAlpha=1;
      rr(barX-4,barY-4,barW+8,barH+8,6);
      ctx.strokeStyle=COLOR.good; ctx.lineWidth=1.6; ctx.stroke();
      pushHit(barX-4,barY-4,barW+8,barH+8,()=> resolveAbilityTarget('face', idx, null));
    }

    // mana — unbounded, so shown as a tallied count rather than a fixed row of pips
    const manaY = y+54;
    manaCrystal(x+24, manaY, 9, true);
    ctx.textBaseline='middle';
    ctx.font="700 16px 'JetBrains Mono'";
    ctx.fillStyle=COLOR.text;
    ctx.textAlign='left';
    const manaLabel = String(p.mana);
    ctx.fillText(manaLabel, x+40, manaY+1);
    ctx.font="600 10.5px 'Manrope'";
    ctx.fillStyle=COLOR.textDim;
    ctx.fillText('mana banked', x+40+ctx.measureText(manaLabel).width+8, manaY+2);
    ctx.textBaseline='alphabetic';

    ctx.font="600 10.5px 'Manrope'";
    ctx.fillStyle=COLOR.textFaint;
    ctx.fillText('Deck '+p.deck.length+'  ·  Hand '+p.hand.length+'/'+MAX_HAND, x+14, y+h-14);

    const drawEnabled = isTurn && p.mana>=DRAW_COST && p.hand.length<MAX_HAND && p.deck.length>0;
    const r = drawButton(x+w-78, y+h-32, 64, 22, 'Draw', {accent:COLOR.mana, sub:DRAW_COST+' mana', enabled:drawEnabled});
    if(drawEnabled) pushHit(r.x,r.y,r.w,r.h, ()=> drawForPlayer(idx));
  }

  function drawSelectionPanel(x,y,w,h){
    rr(x,y,w,h,10);
    ctx.fillStyle=COLOR.surface;
    ctx.fill();
    ctx.strokeStyle=COLOR.lineSoft; ctx.lineWidth=1; ctx.stroke();

    sectionLabel('Selected', x+14, y+22, COLOR.textFaint);

    const sel = state.selection;
    if(!sel){
      ctx.font = "600 12px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.textAlign='left';
      wrapText('Click a card in hand or a unit on the board to inspect it here.', x+14, y+50, w-28, 16, 4, 'left');
      return;
    }

    let entity, isCardInHand=false, unit=null;
    if(sel.kind==='hand'){
      const p = state.players[sel.owner];
      entity = p.hand.find(c=>c.iid===sel.id);
      isCardInHand = true;
    } else {
      unit = findUnit(sel.owner, sel.id);
      entity = unit;
    }
    if(!entity){ state.selection=null; return; }

    const p = state.players[sel.owner];
    const tileX = x+14, tileY = y+34;
    if(isCardInHand) drawCardTile(tileX,tileY,entity,{selected:false, playable:true});
    else drawUnitTile(tileX,tileY,entity,{});

    const infoX = tileX+CARD_W+16;
    ctx.textAlign='left';
    ctx.font="700 13px 'Spectral SC'";
    ctx.fillStyle=COLOR.text;
    ctx.fillText(entity.name, infoX, tileY+16);
    ctx.font="600 10.5px 'Manrope'";
    ctx.fillStyle=p.color;
    ctx.fillText(p.name, infoX, tileY+32);

    const ab = entity.ability;
    ctx.font="600 10.5px 'Manrope'";
    ctx.fillStyle=COLOR.mana;
    ctx.fillText(`${ab.name} · ${ab.cost} mana`, infoX, tileY+50);
    ctx.font="500 10.5px 'Manrope'";
    ctx.fillStyle=COLOR.textDim;
    wrapText(ab.desc, infoX, tileY+64, w-(infoX-x)-14, 13, 3, 'left');

    const by = tileY + CARD_H + 16;
    const isOwnTurn = sel.owner===state.turnPlayer && !state.gameOver;

    if(isCardInHand){
      const playable = isOwnTurn && p.mana>=entity.cost && p.board.length<MAX_BOARD;
      const r = drawButton(x+14, by, w-28, 30, 'Play', {accent:p.color, solid:true, sub:entity.cost+' mana', enabled:playable});
      if(playable) pushHit(r.x,r.y,r.w,r.h, playSelectedCard);
      if(!playable && isOwnTurn && p.board.length>=MAX_BOARD){
        ctx.font="600 10px 'Manrope'"; ctx.fillStyle=COLOR.textFaint; ctx.textAlign='center';
        ctx.fillText('Board is full (6 units)', x+w/2, by+42);
      }
    } else {
      const abReady = isOwnTurn && p.mana>=ab.cost;
      const r1 = drawButton(x+14, by, w-28, 30, ab.name, {accent:COLOR.mana, sub:ab.cost+' mana', enabled:abReady});
      if(abReady) pushHit(r1.x,r1.y,r1.w,r1.h, ()=> beginAbility(sel.owner, sel.id));

      const canAttack = isOwnTurn && !unit.sickness && !unit.attacked;
      const r2 = drawButton(x+14, by+38, w-28, 30, 'Attack', {accent:COLOR.danger, sub: unit.sickness? 'resting' : (unit.attacked? 'already spent':'free'), enabled:canAttack});
      if(canAttack) pushHit(r2.x,r2.y,r2.w,r2.h, ()=> beginAttack(sel.owner, sel.id));
    }
  }

  function drawLogPanel(x,y,w,h){
    rr(x,y,w,h,10);
    ctx.fillStyle=COLOR.surface;
    ctx.fill();
    ctx.strokeStyle=COLOR.lineSoft; ctx.lineWidth=1; ctx.stroke();
    sectionLabel('Ledger log', x+14, y+22, COLOR.textFaint);

    ctx.font = "500 11px 'JetBrains Mono'";
    ctx.textAlign='left';
    const lineH = 15;
    const maxLines = Math.floor((h-34)/lineH);
    const entries = state.log.slice(-maxLines);
    entries.forEach((e,i)=>{
      ctx.fillStyle = i===entries.length-1 ? COLOR.text : COLOR.textFaint;
      let t = e;
      const maxW = w-28;
      while(ctx.measureText(t).width>maxW && t.length>1) t=t.slice(0,-1);
      if(t.length<e.length) t = t.slice(0,-1)+'…';
      ctx.fillText(t, x+14, y+34+i*lineH);
    });
  }

  function drawSidebar(){
    const x = SB_X, w = SB_W;
    drawStatusPanel(x, 14, w, 118, 1);
    drawSelectionPanel(x, 142, w, 260);
    drawLogPanel(x, 414, w, 138);
    drawStatusPanel(x, 564, w, 118, 0);
  }

  function drawGameOver(){
    ctx.fillStyle='rgba(9,11,15,0.78)';
    ctx.fillRect(0,0,LW,LH);
    const w=420,h=190,x=(LW-w)/2,y=(LH-h)/2;
    rr(x,y,w,h,14);
    ctx.fillStyle=COLOR.surface;
    ctx.fill();
    const winner = state.players[state.gameOver.winner];
    ctx.strokeStyle = winner.color; ctx.lineWidth=1.6; ctx.stroke();

    ctx.textAlign='center';
    ctx.font="700 14px 'Spectral SC'";
    ctx.fillStyle=COLOR.textFaint;
    ctx.fillText('THE LEDGER CLOSES', x+w/2, y+42);
    ctx.font="700 26px 'Spectral SC'";
    ctx.fillStyle=winner.color;
    ctx.fillText(winner.name+' wins', x+w/2, y+80);

    const r = drawButton(x+w/2-90, y+120, 180, 38, 'New Game', {accent:COLOR.mana, solid:true});
    pushHit(r.x,r.y,r.w,r.h, initGame);
  }

  // ---------- input ----------
  function toLogical(evt){
    const rect = canvas.getBoundingClientRect();
    const scale = LW / rect.width;
    return { x:(evt.clientX-rect.left)*scale, y:(evt.clientY-rect.top)*scale };
  }
  canvas.addEventListener('click', (evt)=>{
    const {x,y} = toLogical(evt);
    for(let i=hitRegions.length-1;i>=0;i--){
      const r = hitRegions[i];
      if(pointIn(r,x,y)){ r.fn(); return; }
    }
    if(state.pending){ state.pending=null; return; }
    state.selection = null;
  });
  canvas.addEventListener('mousemove', (evt)=>{
    const {x,y} = toLogical(evt);
    let over=false;
    for(let i=hitRegions.length-1;i>=0;i--){ if(pointIn(hitRegions[i],x,y)){ over=true; break; } }
    canvas.style.cursor = over ? 'pointer' : 'default';
  });

  document.fonts.ready.then(()=> requestAnimationFrame(render));
  requestAnimationFrame(render);
})();
