(function(){
  "use strict";

  // ---------- setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const LW = 1300, LH = 900; // logical size
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
    { key:'soldier',     name:'Soldier',        atk:3, hp:4, mono:'SD',
      short:'Attacks one enemy',
      action:'Attacks the enemy in the earliest unresolved slot.' },
    { key:'shieldbearer',name:'Shieldbearer',   atk:0, hp:8, mono:'SH', taunt:true,
      short:'Enemies attack it first',
      action:'While alive, every single-target attack must hit it first. Takes no action of its own.' },
    { key:'archer',      name:'Archer',         atk:2, hp:3, mono:'AR',
      short:'Attacks the weakest enemy',
      action:'Attacks the enemy with the lowest current HP.' },
    { key:'wolf',        name:'Wolf',           atk:2, hp:3, mono:'WF',
      short:'Attacks twice',
      action:'Attacks the earliest unresolved enemy, twice.' },
    { key:'ogre',        name:'Ogre',           atk:5, hp:5, mono:'OG',
      short:'One enormous hit',
      action:'Deals one large hit to the earliest unresolved enemy.' },
    { key:'cleric',      name:'Cleric',         atk:1, hp:3, mono:'CL',
      short:'Heals the most-hurt ally',
      action:'Heals the most damaged ally.' },
    { key:'berserker',   name:'Berserker',      atk:2, hp:5, mono:'BR',
      short:'Hits harder when hurt',
      action:'Attacks the earliest unresolved enemy; deals +1 damage per HP it has lost.' },
    { key:'vampire',     name:'Vampire',        atk:3, hp:4, mono:'VM',
      short:'Heals itself on attack',
      action:'Attacks the earliest unresolved enemy and heals itself for the damage dealt.' },
    { key:'bomber',      name:'Bomber',         atk:2, hp:3, mono:'BM', onDeath:'bomber',
      short:'Explodes on death',
      action:'Attacks the earliest unresolved enemy. Explodes when killed, damaging every enemy.' },
    { key:'dragon',      name:'Dragon',         atk:2, hp:6, mono:'DR',
      short:'Hits every enemy',
      action:'Breathes fire on every living enemy.' },
    { key:'slime',       name:'Slime',          atk:2, hp:6, mono:'SL', onDeath:'slime',
      short:'Splits when killed',
      action:'Attacks the earliest unresolved enemy. Splits into two smaller Slimes when killed, if there is room.' },
    { key:'necromancer', name:'Necromancer',    atk:0, hp:3, mono:'NC',
      short:'Revives a dead ally',
      action:'Revives the earliest-fallen dead ally at half HP.' },
    { key:'executioner', name:'Executioner',    atk:2, hp:4, mono:'EX',
      short:'Executes a critical enemy',
      action:'Instantly kills a critically injured enemy; otherwise strikes the earliest unresolved enemy.' },
    { key:'phoenix',     name:'Phoenix',        atk:2, hp:4, mono:'PX', onDeath:'phoenix',
      short:'Returns once from death',
      action:'Attacks the earliest unresolved enemy. The first time it would die, it returns at half HP instead.' },
    { key:'goblin',      name:'Goblin',         atk:1, hp:1, mono:'GB',
      short:'Weak, cheap attacker',
      action:'Attacks the earliest unresolved enemy. Cheap and fragile.' },
    { key:'golem',       name:'Golem',          atk:3, hp:10, mono:'GL', noHeal:true,
      short:"Durable, can't be healed",
      action:'Extremely durable, but cannot be healed. Attacks the earliest unresolved enemy.' },
    { key:'druid',       name:'Druid',          atk:1, hp:4, mono:'DU',
      short:'Heals all allies a little',
      action:'Gives every surviving ally a little health.' },
    { key:'lightning_mage', name:'Lightning Mage', atk:2, hp:3, mono:'LM',
      short:'Hits 3 random enemies',
      action:'Strikes three random living enemies.' },
    { key:'hunter',      name:'Hunter',         atk:3, hp:4, mono:'HN',
      short:'Extra dmg to healthiest foe',
      action:'Deals extra damage to the enemy with the most health.' },
    { key:'king',        name:'King',           atk:0, hp:5, mono:'KG', auraAtk:2,
      short:'+ATK to allies while alive',
      action:'While alive, gives every other ally +2 ATK. Takes no action of its own.' }
  ];
  const BY_KEY = {};
  ROSTER.forEach(r=>{ BY_KEY[r.key] = r; });

  // ---------- rules constants ----------
  const SLOTS = 6;           // 1..6, alternating ownership
  const PER_SIDE = SLOTS/2;  // 3 slots each
  const WINS_NEEDED = 3;     // best of 5
  const STEP_MS = 850;

  const BOMBER_DMG = 2;          // AoE damage a Bomber deals to every enemy on death
  const EXECUTE_FRAC = 0.5;      // Executioner's "critically injured" threshold (fraction of max HP missing)
  const HUNTER_BONUS = 3;        // Hunter's extra damage to the healthiest enemy
  const LMAGE_HITS = 3;          // enemies a Lightning Mage strikes
  const DRUID_HEAL = 2;          // Druid's AoE heal amount
  const CLERIC_HEAL = 3;         // Cleric's single-target heal amount
  const NECRO_REVIVE_FRAC = 0.5; // fraction of max HP a Necromancer revives at
  const PHOENIX_REVIVE_FRAC = 0.5; // fraction of max HP a Phoenix returns at
  const SLIME_SPLIT_DIV = 2;     // splinters get maxHp/atk divided by this

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
    auto:false,          // step through by hand; Auto is opt-in
    focus:null,          // {actor:slotIdx, target:slotIdx|null, kind}
    explain:null,        // breakdown of the action on screen
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
    return { uid:'u'+(uidCounter++), key, name:t.name, mono:t.mono,
             baseAtk:t.atk, buff:0, hp:t.hp, maxHp:t.hp,
             owner, slot, acted:false, immune:false, dead:false,
             taunt: !!t.taunt, noHeal: !!t.noHeal, auraAtk: t.auraAtk || 0, onDeath: t.onDeath || null,
             phoenixUsed:false,
             flash:0, healFlash:0 };
  }
  function missing(u){ return u.maxHp - u.hp; }
  function isAlive(u){ return !!u && !u.dead; }
  function aliveOf(owner){ return state.slots.filter(u=>isAlive(u) && u.owner===owner); }
  function enemiesOf(owner){ return state.slots.filter(u=>isAlive(u) && u.owner!==owner); }
  function stagedCount(owner){ return state.slots.filter(u=>u && u.owner===owner).length; }

  function atkOf(u){
    let bonus = u.buff;
    const auraSrc = aliveOf(u.owner).find(x=>x.uid!==u.uid && x.auraAtk>0);
    if(auraSrc) bonus += auraSrc.auraAtk;
    return u.baseAtk + bonus;
  }

  // ---------- targeting ----------
  // state.slots is already in slot order, so filtered lists are too.
  // A living Shieldbearer forces every single-target attack onto it; AoE and
  // random multi-target abilities ignore that redirect.
  function attackable(owner){
    const es = enemiesOf(owner);
    const taunters = es.filter(x=>x.taunt);
    return taunters.length ? taunters : es;
  }
  function healable(list){ return list.filter(x=>!x.noHeal); }
  function mostDamaged(list){
    const hurt = list.filter(x=>missing(x)>0);
    if(!hurt.length) return null;
    let best = hurt[0];
    hurt.forEach(x=>{ if(missing(x) > missing(best)) best = x; }); // ties -> earliest slot
    return best;
  }
  function weakest(list){
    if(!list.length) return null;
    let best = list[0];
    list.forEach(x=>{ if(x.hp < best.hp) best = x; }); // ties -> earliest slot
    return best;
  }
  function healthiest(list){
    if(!list.length) return null;
    let best = list[0];
    list.forEach(x=>{ if(x.hp > best.hp) best = x; }); // ties -> earliest slot
    return best;
  }
  function deadOf(owner){ return state.slots.filter(x=>x && x.owner===owner && x.dead); }
  function emptyOwnSlots(owner){
    const r = [];
    for(let i=0;i<SLOTS;i++) if(!state.slots[i] && slotOwner(i)===owner) r.push(i);
    return r;
  }

  // ---------- resolution ----------
  // Every action records which units it weighed and which it picked, so the
  // sequence can be stepped through and read back.
  function out(text, color){
    log('    ' + text, color);
    if(state.explain) state.explain.outcome.push({ text, color: color || COLOR.textDim });
  }

  function weighed(list, chosen, noteFn){
    return list.map(x=>({
      slot:x.slot, name:x.name, owner:x.owner,
      note: noteFn ? noteFn(x) : '',
      chosen: !!chosen && x.uid === chosen.uid
    }));
  }
  function weighedMulti(list, chosenList, noteFn){
    return list.map(x=>({
      slot:x.slot, name:x.name, owner:x.owner,
      note: noteFn ? noteFn(x) : '',
      chosen: chosenList.some(c=>c.uid === x.uid)
    }));
  }

  function doBomberDeath(target){
    const foes = enemiesOf(target.owner);
    if(!foes.length) return;
    foes.forEach(f=>dealDamage(f, BOMBER_DMG));
    out(target.name + ' detonates for ' + BOMBER_DMG + ' on every enemy.', COLOR.danger);
  }

  function doSlimeSplit(target){
    const spots = emptyOwnSlots(target.owner).slice(0,2);
    if(!spots.length){
      out(target.name + ' has no room to split into.', COLOR.textFaint);
      return;
    }
    const childHp = Math.max(1, Math.floor(target.maxHp / SLIME_SPLIT_DIV));
    const childAtk = Math.max(1, Math.floor(target.baseAtk / SLIME_SPLIT_DIV));
    spots.forEach(idx=>{
      const s = makeUnit('slime', target.owner, idx);
      s.maxHp = childHp; s.hp = childHp; s.baseAtk = childAtk;
      s.onDeath = null; // splinters don't split further
      state.slots[idx] = s;
    });
    out(target.name + ' splits into ' + spots.length + ' smaller Slimes.', COLOR.good);
  }

  function dealDamage(target, amount){
    if(target.immune){
      out(target.name + ' is shielded — no damage.', COLOR.mana);
      return;
    }
    target.hp -= amount;
    target.flash = 1;
    if(target.hp <= 0){
      target.hp = 0;
      if(target.onDeath === 'phoenix' && !target.phoenixUsed){
        target.phoenixUsed = true;
        target.hp = Math.max(1, Math.ceil(target.maxHp * PHOENIX_REVIVE_FRAC));
        target.healFlash = 1;
        out(target.name + ' (slot ' + (target.slot+1) + ') rises from the ashes at ' + target.hp + ' HP.', COLOR.mana);
        return;
      }
      target.dead = true;
      out(target.name + ' (slot ' + (target.slot+1) + ') dies.', COLOR.danger);
      if(target.onDeath === 'bomber') doBomberDeath(target);
      else if(target.onDeath === 'slime') doSlimeSplit(target);
    }
  }

  function attack(u, target, amount, verb){
    if(!target){ out('no target — the action fizzles.', COLOR.textFaint); return; }
    state.focus.target = target.slot;
    state.focus.kind = 'hit';
    out(verb + ' ' + target.name + ' (slot ' + (target.slot+1) + ') for ' + amount + '.', pcolor(u.owner));
    dealDamage(target, amount);
  }

  function resolveUnit(u){
    u.immune = false; // protection lasts only until this unit's own action
    state.focus = { actor:u.slot, target:null, kind:'hit' };
    const e = state.explain = { actor:u, rule:'', pool:'', weighed:[], outcome:[], accent:COLOR.danger };
    log('Slot ' + (u.slot+1) + ' — ' + pname(u.owner) + "'s " + u.name + ' acts.', pcolor(u.owner));

    switch(u.key){
      case 'soldier': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.rule = 'Hits the enemy in the EARLIEST unresolved slot.' + (es.length && es[0].taunt ? ' A Shieldbearer is forcing the redirect.' : '');
        e.pool = (es.length && es[0].taunt) ? 'must strike the taunting Shieldbearer' : 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u), 'strikes');
        break;
      }

      case 'shieldbearer': {
        e.rule = 'Enemies must attack it first, for as long as it lives. Takes no action of its own.';
        e.pool = '';
        e.weighed = [];
        out('holds the line — no direct action.', COLOR.textFaint);
        break;
      }

      case 'archer': {
        const es = attackable(u.owner);
        const t = weakest(es);
        e.rule = 'Attacks the WEAKEST enemy by current HP.';
        e.pool = 'living enemies';
        e.weighed = weighed(es, t, x=>x.hp + ' HP');
        attack(u, t, atkOf(u), 'shoots');
        break;
      }

      case 'wolf': {
        const es1 = attackable(u.owner);
        const t1 = es1.find(x=>!x.acted) || es1[0] || null;
        e.rule = 'Attacks the earliest unresolved enemy, TWICE.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es1, t1, x=>x.acted ? 'already acted' : 'unresolved');
        const hitSlots = [];
        if(t1){
          hitSlots.push(t1.slot);
          out('bites ' + t1.name + ' (slot ' + (t1.slot+1) + ') for ' + atkOf(u) + '.', pcolor(u.owner));
          dealDamage(t1, atkOf(u));
        }
        const es2 = attackable(u.owner);
        const t2 = es2.find(x=>!x.acted) || es2[0] || null;
        if(t2){
          hitSlots.push(t2.slot);
          out('bites again — ' + t2.name + ' (slot ' + (t2.slot+1) + ') for ' + atkOf(u) + '.', pcolor(u.owner));
          dealDamage(t2, atkOf(u));
        }
        if(!hitSlots.length) out('no target — the action fizzles.', COLOR.textFaint);
        state.focus.target = hitSlots.length ? hitSlots : null;
        state.focus.kind = 'hit';
        break;
      }

      case 'ogre': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.rule = 'Deals ONE ENORMOUS hit to the earliest unresolved enemy.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u), 'crushes');
        break;
      }

      case 'cleric': {
        const allies = aliveOf(u.owner);
        const candidates = healable(allies);
        const a = mostDamaged(candidates);
        e.accent = COLOR.good;
        e.rule = 'Heals the MOST DAMAGED ally for ' + CLERIC_HEAL + '.';
        e.pool = 'living, healable allies';
        e.weighed = weighed(allies, a, x=>x.noHeal ? 'cannot be healed' : (missing(x) ? ('hurt −' + missing(x) + ' HP') : 'unhurt'));
        if(a){
          const before = a.hp;
          a.hp = Math.min(a.maxHp, a.hp + CLERIC_HEAL);
          a.healFlash = 1;
          state.focus.target = a.slot;
          state.focus.kind = 'heal';
          out('heals ' + a.name + ' (slot ' + (a.slot+1) + ') for ' + (a.hp-before) + '.', COLOR.good);
        } else {
          out('nobody needs healing.', COLOR.textFaint);
        }
        break;
      }

      case 'berserker': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        const bonus = missing(u);
        e.rule = 'Attacks the earliest unresolved enemy; deals +1 damage per HP it has lost.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u) + bonus, bonus ? 'rages and strikes' : 'strikes');
        break;
      }

      case 'vampire': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.accent = COLOR.good;
        e.rule = 'Attacks the earliest unresolved enemy and heals itself for the damage dealt.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        if(t){
          state.focus.target = t.slot;
          state.focus.kind = 'hit';
          const dmg = atkOf(u);
          const wasImmune = t.immune;
          out('drains ' + t.name + ' (slot ' + (t.slot+1) + ') for ' + dmg + '.', pcolor(u.owner));
          dealDamage(t, dmg);
          if(!wasImmune){
            const before = u.hp;
            u.hp = Math.min(u.maxHp, u.hp + dmg);
            if(u.hp > before){ u.healFlash = 1; out('heals itself for ' + (u.hp-before) + '.', COLOR.good); }
          }
        } else {
          out('no target — the action fizzles.', COLOR.textFaint);
        }
        break;
      }

      case 'bomber': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.rule = 'Attacks the earliest unresolved enemy; explodes on death, damaging every enemy.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u), 'lobs a charge at');
        break;
      }

      case 'dragon': {
        const es = enemiesOf(u.owner); // AoE ignores taunt
        e.rule = 'Breathes fire on EVERY living enemy.';
        e.pool = 'living enemies';
        e.weighed = weighedMulti(es, es, ()=>'hit for ' + atkOf(u));
        state.focus.target = es.map(x=>x.slot);
        state.focus.kind = 'hit';
        if(es.length){
          es.forEach(x=>dealDamage(x, atkOf(u)));
          out('breathes fire across the field for ' + atkOf(u) + ' each.', pcolor(u.owner));
        } else {
          out('no enemies left to burn.', COLOR.textFaint);
        }
        break;
      }

      case 'slime': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.rule = 'Attacks the earliest unresolved enemy; splits into two smaller Slimes if killed.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u), 'slams');
        break;
      }

      case 'necromancer': {
        const dead = deadOf(u.owner);
        const t = dead[0] || null;
        e.accent = COLOR.good;
        e.rule = 'Revives the EARLIEST fallen ally at half HP.';
        e.pool = dead.length ? 'fallen allies, lowest slot first' : 'no fallen allies';
        e.weighed = weighed(dead, t, x=>'slot ' + (x.slot+1));
        if(t){
          t.dead = false;
          t.hp = Math.max(1, Math.ceil(t.maxHp * NECRO_REVIVE_FRAC));
          t.healFlash = 1;
          state.focus.target = t.slot;
          state.focus.kind = 'heal';
          out('calls ' + t.name + ' (slot ' + (t.slot+1) + ') back to ' + t.hp + ' HP.', COLOR.good);
        } else {
          out('no fallen ally to revive.', COLOR.textFaint);
        }
        break;
      }

      case 'executioner': {
        const es = attackable(u.owner);
        const critical = es.filter(x=>missing(x) >= x.maxHp * EXECUTE_FRAC);
        const t = critical[0] || null;
        e.rule = 'Instantly kills an enemy at or below ' + Math.round(EXECUTE_FRAC*100) + '% HP; otherwise strikes the earliest unresolved enemy.';
        if(t){
          e.pool = 'critically injured enemies';
          e.weighed = weighed(es, t, x=>missing(x) >= x.maxHp*EXECUTE_FRAC ? 'critical' : (x.acted ? 'already acted' : 'unresolved'));
          state.focus.target = t.slot;
          state.focus.kind = 'hit';
          out('executes ' + t.name + ' (slot ' + (t.slot+1) + ').', COLOR.danger);
          dealDamage(t, t.hp);
        } else {
          const fallback = es.find(x=>!x.acted) || es[0] || null;
          e.pool = 'nobody critical — falls back to the earliest slot';
          e.weighed = weighed(es, fallback, x=>x.acted ? 'already acted' : 'unresolved');
          attack(u, fallback, atkOf(u), 'strikes');
        }
        break;
      }

      case 'phoenix': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.rule = 'Attacks the earliest unresolved enemy; returns once at half HP if it would die.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u), 'strikes');
        break;
      }

      case 'goblin': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.rule = 'Weak and cheap. Attacks the earliest unresolved enemy.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u), 'jabs');
        break;
      }

      case 'golem': {
        const es = attackable(u.owner);
        const t = es.find(x=>!x.acted) || es[0] || null;
        e.rule = 'Extremely durable, but cannot be healed. Attacks the earliest unresolved enemy.';
        e.pool = 'living enemies, lowest slot first';
        e.weighed = weighed(es, t, x=>x.acted ? 'already acted' : 'unresolved');
        attack(u, t, atkOf(u), 'smashes');
        break;
      }

      case 'druid': {
        const allies = aliveOf(u.owner);
        const candidates = healable(allies);
        e.accent = COLOR.good;
        e.rule = 'Gives every surviving ally +' + DRUID_HEAL + ' HP.';
        e.pool = 'living, healable allies';
        e.weighed = weighedMulti(allies, candidates, x=>x.noHeal ? 'cannot be healed' : (missing(x) ? ('hurt −' + missing(x) + ' HP') : 'full HP'));
        state.focus.target = candidates.map(x=>x.slot);
        state.focus.kind = 'heal';
        candidates.forEach(x=>{
          const before = x.hp;
          x.hp = Math.min(x.maxHp, x.hp + DRUID_HEAL);
          if(x.hp > before) x.healFlash = 1;
        });
        out('blesses the ranks for +' + DRUID_HEAL + ' HP each.', COLOR.good);
        break;
      }

      case 'lightning_mage': {
        const es = enemiesOf(u.owner); // ignores taunt — a scattershot, not a targeted strike
        const pool = es.slice();
        for(let i=pool.length-1;i>0;i--){
          const j = Math.floor(Math.random()*(i+1));
          const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
        }
        const chosen = pool.slice(0, Math.min(LMAGE_HITS, pool.length));
        e.rule = 'Strikes ' + LMAGE_HITS + ' RANDOM living enemies.';
        e.pool = 'living enemies, rolled at random';
        e.weighed = weighedMulti(es, chosen, ()=>'rolled');
        state.focus.target = chosen.map(x=>x.slot);
        state.focus.kind = 'hit';
        if(chosen.length){
          chosen.forEach(x=>dealDamage(x, atkOf(u)));
          out('calls down lightning on ' + chosen.length + ' enem' + (chosen.length===1?'y':'ies') + ' for ' + atkOf(u) + ' each.', pcolor(u.owner));
        } else {
          out('no enemies left to strike.', COLOR.textFaint);
        }
        break;
      }

      case 'hunter': {
        const es = attackable(u.owner);
        const t = healthiest(es);
        e.rule = 'Deals +' + HUNTER_BONUS + ' damage to the enemy with the MOST health.';
        e.pool = 'living enemies';
        e.weighed = weighed(es, t, x=>x.hp + ' HP');
        attack(u, t, atkOf(u) + (t ? HUNTER_BONUS : 0), 'hunts down');
        break;
      }

      case 'king': {
        e.accent = COLOR.good;
        e.rule = 'While alive, gives every other ally +2 ATK. Takes no action of its own.';
        e.pool = '';
        e.weighed = [];
        out('rallies the ranks — no direct action.', COLOR.textFaint);
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
        state.focus = { actor:u.slot, target:null, kind:'hit' };
        state.explain = { actor:u, skipped:true, accent:COLOR.danger, weighed:[], outcome:[],
          rule:'Killed before its slot came up, so its action never happens. This is what winning the sequence buys you.',
          pool:'' };
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
    state.explain = null;
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
    state.explain = null;
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
    state.explain = null;
    state.roundResult = null;
    state.matchWinner = null;
    state.phase = 'stage';
    state.log = [];
    log('Both sides stage in secret, then the sequence resolves 1 through ' + SLOTS + '.', COLOR.textDim);
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

  // Every unit is drawn as a two-letter monogram badge rather than a
  // hand-drawn icon — the roster is too large now for bespoke glyphs per
  // unit, and the badge scales cleanly from tiny palette chips to slot cards.
  function drawBadge(cx, cy, r, letters, color, fillMul){
    const baseAlpha = ctx.globalAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.fillStyle = color;
    ctx.globalAlpha = baseAlpha * (fillMul!=null ? fillMul : 0.25);
    ctx.fill();
    ctx.globalAlpha = baseAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = "700 " + Math.max(7, Math.round(r*0.78)) + "px 'Manrope'";
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letters, cx, cy+0.5);
  }

  // ---------- layout ----------
  // Each team gets its own row: the opponent's slots on top, the player's
  // slots on the bottom. A lane (column) always holds the same pair of slot
  // numbers (0,1 / 2,3 / 4,5) — only which row a given slot's card renders
  // in swaps as slotOwner() flips each round.
  const M = 14;
  const SLOT_W = 210, SLOT_H = 170, SLOT_GAP = 28;
  const ROW_W = PER_SIDE*SLOT_W + (PER_SIDE-1)*SLOT_GAP;
  const ROW_X0 = (LW - ROW_W) / 2;
  const ROW_TOP_Y = 96;                              // opponent's row
  const ROW_GAP_Y = 58;                              // room for the attack arc between rows
  const ROW_BOT_Y = ROW_TOP_Y + SLOT_H + ROW_GAP_Y;  // player's row
  const BAND_Y = ROW_BOT_Y + SLOT_H + 14;            // ready / sim controls
  const BAND_H = 40;
  const PANEL_Y = BAND_Y + BAND_H + 22;              // palette, readout or scoreboard
  const PANEL_H = 150;                               // taller: the roster grid is now 20 chips, 10x2
  const LOG_Y = PANEL_Y + PANEL_H + 14;
  const LOG_H = LH - LOG_Y - M;

  let hitRegions = [];
  function pushHit(x,y,w,h,fn){ hitRegions.push({x,y,w,h,fn}); }
  function pointIn(r,px,py){ return px>=r.x && px<=r.x+r.w && py>=r.y && py<=r.y+r.h; }
  function laneOf(i){ return Math.floor(i/2); }
  function isTopRow(i){ return slotOwner(i) === 1; }  // owner 1 = opponent, drawn on top
  function cardX(i){ return ROW_X0 + laneOf(i)*(SLOT_W+SLOT_GAP); }
  function cardY(i){ return isTopRow(i) ? ROW_TOP_Y : ROW_BOT_Y; }

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
    const x = cardX(i), y = cardY(i), owner = slotOwner(i), col = pcolor(owner);
    const u = state.slots[i];
    const isActor  = state.focus && state.focus.actor === i;
    const isTarget = state.focus && state.focus.target!=null &&
      (Array.isArray(state.focus.target) ? state.focus.target.includes(i) : state.focus.target === i);
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

    // badge
    const cx = x + SLOT_W/2, gy = y + 46;
    drawBadge(cx, gy, 15, u.mono, col, 0.24);

    // name
    ctx.font = "700 12px 'Manrope'";
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(u.name, cx, y+78);

    // stats
    const pw = 42;
    statPill(cx-pw-3, y+86, pw, 18, 'A', atkOf(u), atkOf(u) > u.baseAtk ? COLOR.good : COLOR.textDim);
    statPill(cx+3,    y+86, pw, 18, 'H', u.hp,     missing(u) ? COLOR.danger : COLOR.textDim);

    // action reminder
    ctx.font = "500 9.5px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    wrapText(BY_KEY[u.key].short, cx, y+118, SLOT_W-14, 11, 3, 'center');
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
      if(atkOf(u) > u.baseAtk) badge('+' + (atkOf(u)-u.baseAtk), COLOR.good);
      if(u.immune)  badge('SHIELD', COLOR.mana);
      if(u.taunt)   badge('TAUNT', COLOR.danger);
      if(u.noHeal)  badge('NO HEAL', COLOR.textFaint);
      if(u.auraAtk) badge('AURA', COLOR.good);
      if(resolved)  badge('DONE', COLOR.textFaint);
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
    ctx.fillText('simultaneous staging · slot order resolves 1 → ' + SLOTS, M+152, 33);

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
      let nx = -1;
      for(let i=state.simIndex;i<SLOTS;i++){ if(state.slots[i]){ nx = i; break; } }
      const done = state.simIndex >= SLOTS;
      drawButton(M, BAND_Y, 150, BAND_H, done ? 'Finish round' : 'Step  ▸',
        { accent:COLOR.mana, solid:true, onClick:()=>stepSim() });
      drawButton(M+160, BAND_Y, 108, BAND_H, state.auto ? 'Auto ▮▮' : 'Auto ▶',
        { accent:state.auto ? COLOR.mana : COLOR.line, onClick:()=>{ state.auto = !state.auto; } });

      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const my = BAND_Y + BAND_H/2;
      if(nx >= 0){
        const nu = state.slots[nx];
        ctx.font = "600 12px 'Manrope'";
        ctx.fillStyle = COLOR.textFaint;
        ctx.fillText('next', M+284, my);
        ctx.font = "700 13px 'Manrope'";
        ctx.fillStyle = pcolor(nu.owner);
        ctx.fillText('slot ' + (nx+1) + ' — ' + pname(nu.owner) + "'s " + nu.name + (nu.dead ? '  (dead, skipped)' : ''), M+318, my);
      } else {
        ctx.font = "700 13px 'Manrope'";
        ctx.fillStyle = COLOR.textDim;
        ctx.fillText('Sequence complete.', M+284, my);
      }
      ctx.textAlign = 'right';
      ctx.font = "700 12px 'JetBrains Mono'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.fillText(Math.min(state.simIndex, SLOTS) + ' / ' + SLOTS + ' resolved  ·  space to step', LW-M, my);
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
    ctx.fillText('ROSTER — both sides draw from the same twenty, duplicates allowed', M, PANEL_Y-14);

    const cols = 10, rows = 2, gapX = 8, gapY = 8;
    const chipW = (LW - 2*M - (cols-1)*gapX) / cols;
    const chipH = (PANEL_H - (rows-1)*gapY) / rows;

    ROSTER.forEach((t,i)=>{
      const col = i % cols, row = Math.floor(i/cols);
      const x = M + col*(chipW+gapX), y = PANEL_Y + row*(chipH+gapY);
      const sel = state.picked === t.key;
      rr(x,y,chipW,chipH,7);
      ctx.fillStyle = sel ? COLOR.surface3 : COLOR.surface2;
      ctx.fill();
      ctx.strokeStyle = sel ? COLOR.mana : COLOR.line;
      ctx.lineWidth = sel ? 2 : 1.1;
      ctx.stroke();

      drawBadge(x+17, y+18, 11, t.mono, COLOR.mana, 0.2);

      ctx.font = "700 10.5px 'Manrope'";
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(t.name, x+32, y+13);

      ctx.font = "700 9px 'JetBrains Mono'";
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(t.atk + '/' + t.hp, x+32, y+27);

      ctx.font = "500 8.5px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      wrapText(t.short, x+chipW/2, y+chipH-19, chipW-10, 10, 2, 'center');

      pushHit(x,y,chipW,chipH, ()=>{ state.picked = sel ? null : t.key; });
    });
  }

  // ---------- action readout (sim) ----------
  function focusColor(kind){
    if(kind==='buff' || kind==='heal') return COLOR.good;
    if(kind==='shield') return COLOR.mana;
    return COLOR.danger;
  }

  function drawArrowHead(tipX, tipY, ux, uy, color){
    // ux,uy: unit vector pointing in the direction of travel, tip-ward
    const px = -uy, py = ux;
    const bx = tipX - ux*9, by = tipY - uy*9;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(bx+px*5, by+py*5);
    ctx.lineTo(bx-px*5, by-py*5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawFocusArrow(){
    const f = state.focus;
    if(!f || f.target===null || f.target===undefined) return;
    const targets = Array.isArray(f.target) ? f.target : [f.target];
    targets.forEach(t=>drawOneArrow(f.actor, t, f.kind));
  }

  function drawOneArrow(a, t, kind){
    const col = focusColor(kind);
    const ax = cardX(a)+SLOT_W/2, tx = cardX(t)+SLOT_W/2;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;

    if(isTopRow(a) === isTopRow(t)){
      // same team, same row (buff / heal / shield) — a small arc that dips
      // just outside that row, same as a single-row layout would draw it.
      const rowY = cardY(a);
      const baseY = rowY - 6, peakY = rowY - 28;
      ctx.beginPath();
      ctx.moveTo(ax, baseY);
      ctx.quadraticCurveTo((ax+tx)/2, peakY, tx, baseY);
      ctx.stroke();
      ctx.beginPath();             // arrowhead into the target
      ctx.moveTo(tx, baseY+6);
      ctx.lineTo(tx-5, baseY-3);
      ctx.lineTo(tx+5, baseY-3);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.beginPath();             // origin dot
      ctx.arc(ax, baseY, 3, 0, Math.PI*2);
      ctx.fillStyle = col;
      ctx.fill();
    } else {
      // attack across the gap between the two rows.
      const gapTop = ROW_TOP_Y + SLOT_H, gapBot = ROW_BOT_Y;
      const ay = isTopRow(a) ? gapTop+4 : gapBot-4;
      const ty = isTopRow(t) ? gapTop+4 : gapBot-4;
      const midY = (gapTop + gapBot) / 2;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax+tx)/2, midY, tx, ty);
      ctx.stroke();
      const dx = tx - (ax+tx)/2, dy = ty - midY;
      const len = Math.hypot(dx,dy) || 1;
      drawArrowHead(tx, ty, dx/len, dy/len, col);
      ctx.beginPath();             // origin dot
      ctx.arc(ax, ay, 3, 0, Math.PI*2);
      ctx.fillStyle = col;
      ctx.fill();
    }
  }

  function drawExplain(){
    ctx.font = "700 11px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('THIS ACTION', M, PANEL_Y-13);

    rr(M, PANEL_Y, LW-2*M, PANEL_H, 9);
    ctx.fillStyle = COLOR.surface2; ctx.fill();
    ctx.strokeStyle = COLOR.line; ctx.lineWidth = 1.2; ctx.stroke();

    const e = state.explain;
    if(!e){
      ctx.font = "600 13px 'Manrope'";
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Click Step to resolve slot 1.', LW/2, PANEL_Y+PANEL_H/2);
      return;
    }

    const u = e.actor;
    const C1 = M+18, C1W = 296;
    const C2 = 372,  C2W = 528;
    const C3 = 942,  C3W = LW-M-16-942;

    [350, 918].forEach(dx=>{
      ctx.beginPath();
      ctx.moveTo(dx, PANEL_Y+14); ctx.lineTo(dx, PANEL_Y+PANEL_H-14);
      ctx.strokeStyle = COLOR.lineSoft; ctx.lineWidth = 1; ctx.stroke();
    });

    // -- who is acting
    drawBadge(C1+18, PANEL_Y+30, 14, u.mono, pcolor(u.owner), 0.25);

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = "700 15px 'Manrope'";
    ctx.fillStyle = e.skipped ? COLOR.textFaint : COLOR.text;
    ctx.fillText(u.name + (e.skipped ? ' — never acts' : ''), C1+44, PANEL_Y+23);
    ctx.font = "700 11px 'JetBrains Mono'";
    ctx.fillStyle = COLOR.textDim;
    ctx.fillText('slot ' + (u.slot+1) + ' · ' + pname(u.owner) + ' · ' + atkOf(u) + ' ATK / ' + u.hp + ' HP', C1+44, PANEL_Y+40);
    ctx.font = "500 11.5px 'Manrope'";
    ctx.fillStyle = COLOR.textDim;
    wrapText(e.rule, C1, PANEL_Y+68, C1W, 14, 4, 'left');

    // -- who it weighed up
    ctx.font = "700 10px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText('CONSIDERED' + (e.pool ? ' — ' + e.pool : ''), C2, PANEL_Y+18);
    if(!e.weighed.length){
      ctx.font = "500 12px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.fillText(e.skipped ? '—' : 'nobody to choose from', C2, PANEL_Y+42);
    }
    e.weighed.forEach((c,i)=>{
      const y = PANEL_Y+40 + i*19;
      if(y > PANEL_Y+PANEL_H-10) return;
      if(c.chosen){
        rr(C2-8, y-9.5, C2W+12, 19, 5);
        ctx.fillStyle = e.accent; ctx.globalAlpha = 0.14; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = e.accent; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = "700 10.5px 'JetBrains Mono'";
      ctx.fillStyle = c.chosen ? pcolor(c.owner) : COLOR.textFaint;
      ctx.fillText(String(c.slot+1).padStart(2,'0'), C2, y);
      ctx.font = (c.chosen ? '700' : '500') + " 12px 'Manrope'";
      ctx.fillStyle = c.chosen ? COLOR.text : COLOR.textDim;
      ctx.fillText(c.name, C2+28, y);
      ctx.font = "500 10.5px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.fillText(c.note, C2+164, y);
      if(c.chosen){
        ctx.textAlign = 'right';
        ctx.font = "700 10px 'Manrope'";
        ctx.fillStyle = e.accent;
        ctx.fillText('PICKED', C2+C2W, y);
      }
    });

    // -- what happened
    ctx.textAlign = 'left';
    ctx.font = "700 10px 'Manrope'";
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText('RESULT', C3, PANEL_Y+18);
    let ry = PANEL_Y+40;
    if(!e.outcome.length){
      ctx.font = "500 12px 'Manrope'";
      ctx.fillStyle = COLOR.textFaint;
      ctx.fillText('—', C3, ry);
    }
    e.outcome.forEach(o=>{
      if(ry > PANEL_Y+PANEL_H-14) return;
      ctx.font = "600 12px 'Manrope'";
      ctx.fillStyle = o.color;
      const n = wrapText(o.text, C3, ry, C3W, 14, 3, 'left');
      ry += n*14 + 4;
    });
  }

  // ---------- scoreboard (round end) ----------
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
    if(state.phase==='sim') drawFocusArrow();
    drawBand();
    if(state.phase==='stage') drawPalette();
    else if(state.phase==='sim') drawExplain();
    else drawScoreboard();
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
