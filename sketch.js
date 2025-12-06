// --- Configuration ---
const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;
const BG_COLOR = '#3f332d';
const PARTICLE_COLOR = '#97dbd9';
const NUM_PARTICLES = 9000;
const PARTICLE_SIZE_MULTIPLIER = 5;
const L_CHLADNI_SCALE = CANVAS_WIDTH / 3;

// Physics Variables
let stableM = 1, stableN = 1;
let particles = [];
let patternShouldForm = true; // Always true by default in manual mode
let lastScatterTime = 0;
const SCATTER_DURATION = 500;

// UI Variables
let sliderM, sliderN;

// Sound Engine
let movementNoise, movementFilter;
let settleOscillators = [];
const NUM_SETTLE_OSCILLATORS = 4;
let reverb;
let audioContextStarted = false;

// Recording
let recorder, recordedChunks = [];
let isRecording = false;

// --- Sound Calculations ---
function calculateFrequencyFromMN(m, n) {
  // Musical formula approximation: 
  // Frequency scales with the complexity of the pattern (m + n)
  // Low M/N = Low Pitch, High M/N = High Pitch
  // Mapped to a soothing low octave range (50Hz - 600Hz)
  let complexity = (m * 1.2) + (n * 1.2); 
  let freq = map(complexity, 2, 40, 50, 600);
  return freq;
}

function chladni(x, y, m_val, n_val) {
  let term1 = cos(n_val * PI * x / L_CHLADNI_SCALE) * cos(m_val * PI * y / L_CHLADNI_SCALE);
  let term2 = cos(m_val * PI * x / L_CHLADNI_SCALE) * cos(n_val * PI * y / L_CHLADNI_SCALE);
  return term1 - term2;
}

class Particle {
  constructor() {
    this.pos = createVector(random(CANVAS_WIDTH), random(CANVAS_HEIGHT));
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.maxSpeed = 2.5;
    this.maxForce = 0.4;
    this.color = color(PARTICLE_COLOR);
    this.isSettled = false;
  }
  
  getChladniValue(x_coord, y_coord) {
    let scaledX = map(x_coord, 0, CANVAS_WIDTH, -L_CHLADNI_SCALE, L_CHLADNI_SCALE);
    let scaledY = map(y_coord, 0, CANVAS_HEIGHT, -L_CHLADNI_SCALE, L_CHLADNI_SCALE);
    return abs(chladni(scaledX, scaledY, stableM, stableN));
  }
  
  applyForce(force) { this.acc.add(force); }
  
  update() {
    this.vel.add(this.acc);
    this.vel.limit(this.maxSpeed);
    this.pos.add(this.vel);
    this.acc.mult(0);
    
    // Wrap around canvas
    if (this.pos.x < 0) this.pos.x = CANVAS_WIDTH;
    if (this.pos.x > CANVAS_WIDTH) this.pos.x = 0;
    if (this.pos.y < 0) this.pos.y = CANVAS_HEIGHT;
    if (this.pos.y > CANVAS_HEIGHT) this.pos.y = 0;
  }
  
  behave(forming) {
    // Scatter Effect
    if (millis() < lastScatterTime + SCATTER_DURATION) {
      this.applyForce(p5.Vector.random2D().mult(0.8));
      this.vel.mult(0.9);
      this.update();
      this.isSettled = false;
      return;
    }
    
    // Pattern Forming Logic
    if (forming) {
      let chladniVal = this.getChladniValue(this.pos.x, this.pos.y);
      let tolerance = 0.03;
      let checkDistance = 2;
      
      if (chladniVal < tolerance) {
        this.vel.mult(0.8);
        this.acc.mult(0);
        this.isSettled = true;
      } else {
        // Gradient Descent
        let steerForce = createVector(0, 0);
        let rightVal = this.getChladniValue(this.pos.x + checkDistance, this.pos.y);
        let leftVal = this.getChladniValue(this.pos.x - checkDistance, this.pos.y);
        let downVal = this.getChladniValue(this.pos.x, this.pos.y + checkDistance);
        let upVal = this.getChladniValue(this.pos.x, this.pos.y - checkDistance);
        
        if (rightVal < chladniVal) steerForce.x += 1; else if (rightVal > chladniVal) steerForce.x -= 1;
        if (leftVal < chladniVal) steerForce.x -= 1; else if (leftVal > chladniVal) steerForce.x += 1;
        if (downVal < chladniVal) steerForce.y += 1; else if (downVal > chladniVal) steerForce.y -= 1;
        if (upVal < chladniVal) steerForce.y -= 1; else if (upVal > chladniVal) steerForce.y += 1;
        
        if (steerForce.mag() > 0) {
          steerForce.normalize().mult(this.maxForce);
          this.applyForce(steerForce);
        } else {
          this.applyForce(p5.Vector.random2D().mult(0.01));
        }
        this.vel.mult(0.98);
        this.isSettled = false;
      }
    }
    this.update();
  }
  
  display() {
    fill(this.color);
    noStroke();
    rect(this.pos.x, this.pos.y, PARTICLE_SIZE_MULTIPLIER, PARTICLE_SIZE_MULTIPLIER);
  }
}

function setup() {
  pixelDensity(2);
  let cnv = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  
  let canvasTarget = select('#canvas-target');
  if (canvasTarget) cnv.parent('canvas-target');
  else console.warn("Missing #canvas-target div");
  
  background(BG_COLOR);
  rectMode(CENTER);
  
  for (let i = 0; i < NUM_PARTICLES; i++) particles.push(new Particle());
  
  // --- UI SETUP ---
  let uiContainer = select('#ui-controls');
  let parentTarget = uiContainer || createDiv();

  // 1. Record Button
  const recBtn = createButton('RECORD VIDEO');
  recBtn.parent(parentTarget);
  recBtn.mousePressed(toggleRecording);
  
  // 2. M Slider
  let mContainer = createDiv('');
  mContainer.parent(parentTarget);
  mContainer.style('display', 'flex');
  mContainer.style('align-items', 'center');
  mContainer.style('gap', '10px');
  
  createSpan('M VALUE:').parent(mContainer).style('font-weight', 'bold');
  sliderM = createSlider(1, 15, 1, 1);
  sliderM.parent(mContainer);
  sliderM.style('width', '150px');
  sliderM.input(() => {
    ensureAudioStarted();
    stableM = sliderM.value();
    patternShouldForm = true;
  });
  
  // 3. N Slider
  let nContainer = createDiv('');
  nContainer.parent(parentTarget);
  nContainer.style('display', 'flex');
  nContainer.style('align-items', 'center');
  nContainer.style('gap', '10px');
  
  createSpan('N VALUE:').parent(nContainer).style('font-weight', 'bold');
  sliderN = createSlider(1, 15, 1, 1);
  sliderN.parent(nContainer);
  sliderN.style('width', '150px');
  sliderN.input(() => {
    ensureAudioStarted();
    stableN = sliderN.value();
    patternShouldForm = true;
  });
  
  // --- SOUND SETUP ---
  movementNoise = new p5.Noise('white');
  movementNoise.amp(0);
  movementNoise.start();
  movementFilter = new p5.Filter('lowpass');
  movementNoise.disconnect();
  movementNoise.connect(movementFilter);
  movementFilter.res(1.5);
  
  // Sine waves for pure, ethereal tone
  for (let i = 0; i < NUM_SETTLE_OSCILLATORS; i++) {
    let osc = new p5.Oscillator('sine');
    osc.amp(0);
    osc.start();
    settleOscillators.push(osc);
  }
  
  reverb = new p5.Reverb();
  reverb.set(6, 2); // 6 seconds decay for huge space
  reverb.drywet(0.6); 
  
  movementFilter.disconnect();
  movementFilter.connect(reverb);
  
  for(let osc of settleOscillators) {
    osc.disconnect();
    osc.connect(reverb);
  }
  reverb.connect(p5.soundOut);
}

function ensureAudioStarted() {
  if (!audioContextStarted) {
    userStartAudio();
    audioContextStarted = true;
  }
}

function mousePressed() {
  // Start audio on any click on the canvas/page
  ensureAudioStarted();
}

function draw() {
  background(BG_COLOR + 'A0'); // Slight transparency for trails
  
  let numSettledParticles = 0;
  let numMovingParticles = 0;
  
  for (let p of particles) {
    p.behave(patternShouldForm);
    p.display();
    if (p.isSettled) {
      numSettledParticles++;
    } else {
      numMovingParticles++;
    }
  }
  
  // --- SOUND GENERATION ---
  
  // 1. Noise represents chaos/movement
  let movementAmp = map(numMovingParticles, 0, NUM_PARTICLES, 0.0, 0.05);
  movementNoise.amp(movementAmp, 0.2); 
  let movementFilterFreq = map(numMovingParticles, 0, NUM_PARTICLES, 100, 800);
  movementFilter.freq(movementFilterFreq);
  
  // 2. Oscillators represent the pattern (Logic based on M/N)
  let baseFreq = calculateFrequencyFromMN(stableM, stableN);
  
  // Volume rises as particles settle
  let overallSettleAmp = map(numSettledParticles, 0, NUM_PARTICLES, 0, 0.4);
  
  // Create an ethereal chord (Root, 5th, Octave, 10th)
  const melodicIntervals = [1, 1.5, 2, 2.5]; 
  
  for (let i = 0; i < NUM_SETTLE_OSCILLATORS; i++) {
    let osc = settleOscillators[i];
    let intervalMultiplier = melodicIntervals[i % melodicIntervals.length];
    
    // Smooth frequency transition
    let oscFreq = baseFreq * intervalMultiplier;
    // Slight detuning for warmth
    if (i > 0) oscFreq += (sin(frameCount * 0.01 + i) * 1.5);
    
    let oscAmp = overallSettleAmp / (i === 0 ? 1 : 1.5); 
    oscAmp = constrain(oscAmp, 0, 0.4);
    
    osc.freq(oscFreq, 0.15); // Slide to pitch
    osc.amp(oscAmp, 0.15);   // Fade volume
  }
}

// --- RECORDING FUNCTIONS ---
function toggleRecording() {
  if (!isRecording) startRecording();
  else stopRecording();
}

function startRecording() {
  let stream = document.querySelector('canvas').captureStream(60);
  let audioStream = p5.getAudioContext().createMediaStreamDestination();
  p5.soundOut.connect(audioStream);
  let combinedStream = new MediaStream();
  combinedStream.addTrack(stream.getVideoTracks()[0]);
  combinedStream.addTrack(audioStream.stream.getAudioTracks()[0]);
  
  recorder = new MediaRecorder(combinedStream, {
    mimeType: 'video/webm; codecs="vp9,opus"',
    videoBitsPerSecond: 15_000_000,
    audioBitsPerSecond: 128_000
  });
  
  recorder.ondataavailable = e => recordedChunks.push(e.data);
  recorder.onstop = saveRecording;
  recorder.start();
  isRecording = true;
}

function stopRecording() {
  recorder.stop();
  isRecording = false;
}

function saveRecording() {
  let blob = new Blob(recordedChunks, { type: 'video/webm' });
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = 'chladni_ethereal.webm';
  a.click();
  URL.revokeObjectURL(url);
  recordedChunks = [];
}

// --- KEYBOARD CONTROLS ---
function keyPressed() {
  if (key === 'S' || key === 's') {
    // Reset to base state 1,1
    stableM = 1;
    stableN = 1;
    sliderM.value(1);
    sliderN.value(1);
    
    // Trigger scatter
    patternShouldForm = false;
    lastScatterTime = millis();
    
    ensureAudioStarted();
  }
}
