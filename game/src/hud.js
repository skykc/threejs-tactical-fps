// The DOM HUD: crosshair, hit marker, health and armour, ammo, money, the round
// timer and the score, the bomb status, the kill feed and the buy menu. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out. Every
// setter skips a DOM write when the value did not change, so the HUD costs nothing
// on frames where nothing happened.
import { WEAPONS, GRENADE, ARMOR } from './weapon.js';

const COPY = {
  start: {
    title: 'Depot 9',
    copy: 'Attackers plant the bomb at A or B. Defenders hold the sites. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'Depot 9',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const grenadeNum = $('grenade-num');
  const moneyNum = $('money-num');
  const timerNum = $('timer-num');
  const scoreNum = $('score-num');
  const aliveNum = $('alive-num');
  const bombBox = $('bomb');
  const banner = $('banner');
  const feed = $('feed');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const buy = $('buy');
  const buyMoney = $('buy-money');
  const buyList = $('buy-list');
  let hitTimer = 0;
  let bannerTimer = 0;
  let damageTimer = 0;
  let last = {};

  function changed(key, value) {
    if (last[key] === value) return false;
    last[key] = value;
    return true;
  }

  return {
    setHealth(health, armor) {
      if (changed('hp', health)) {
        healthNum.textContent = String(Math.ceil(health));
        healthFill.style.width = `${Math.max(0, health)}%`;
        healthFill.classList.toggle('low', health <= 30);
      }
      if (changed('ar', armor)) armorNum.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, reserve, name, grenades) {
      if (changed('mag', mag)) ammoMag.textContent = String(mag);
      if (changed('res', reserve)) ammoReserve.textContent = `/ ${reserve}`;
      if (changed('wname', name)) weaponName.textContent = name;
      if (changed('gr', grenades)) grenadeNum.textContent = grenades > 0 ? `◉ ${grenades}` : '';
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      if (changed('money', value)) moneyNum.textContent = `$${value}`;
    },
    setTimer(seconds, phase) {
      const text = `${Math.max(0, Math.ceil(seconds))}`;
      if (changed('timer', text + phase)) {
        timerNum.textContent = text;
        timerNum.classList.toggle('buy', phase === 'buy');
      }
    },
    setScore(wins, losses) {
      const text = `${wins} — ${losses}`;
      if (changed('score', text)) scoreNum.textContent = text;
    },
    setAlive(attackers, defenders) {
      const text = `V ${attackers} · S ${defenders}`;
      if (changed('alive', text)) aliveNum.textContent = text;
    },
    setBomb(text) {
      if (changed('bomb', text)) {
        bombBox.textContent = text;
        bombBox.hidden = !text;
      }
    },
    setSpread(spreadPx) {
      crosshair.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), 180);
    },
    bannerText(text, holdMs = 2600) {
      banner.textContent = text;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 4) feed.removeChild(feed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    setPlant(progress, label) {
      if (progress <= 0) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.min(100, progress * 100)}%`;
      plantFill.textContent = label;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = detail ?? text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    showBuy(money, owned, onBuy) {
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      const rows = [
        ...Object.values(WEAPONS).map((w) => ({ id: w.id, name: w.name, price: w.price, note: `${w.damage} dmg · ${w.mag} rnd` })),
        { id: GRENADE.id, name: GRENADE.name, price: GRENADE.price, note: 'radius blast' },
        { id: ARMOR.id, name: ARMOR.name, price: ARMOR.price, note: 'soaks half of hits' },
      ];
      for (const row of rows) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-row';
        const isOwned = owned.includes(row.id);
        button.disabled = money < row.price || isOwned;
        button.innerHTML = `<b>${row.name}</b><span>${row.note}</span><em>${isOwned ? 'OWNED' : `$${row.price}`}</em>`;
        button.addEventListener('click', () => onBuy(row.id, row.price));
        buyList.appendChild(button);
      }
      buy.hidden = false;
    },
    hideBuy() {
      buy.hidden = true;
    },
    buyVisible() {
      return !buy.hidden;
    },
  };
}
