/**
 * Seed data.
 *
 * TAXONOMY (categories, component types, tools) is structural and seeded in every environment.
 *
 * DEMONSTRATION DATA (everything else) uses FICTIONAL products from the fictional brand
 * "Demo Devices". It encodes general, widely-taught repair heuristics so the platform's
 * workflows can be exercised end to end. It is NOT verified knowledge: every row is flagged
 * is_demo / verification_status = 'demo' and cites the tier-0 "demonstration" source. Product
 * specifications are invented for fictional products and are labelled as such.
 * Barcodes use the GS1 restricted-circulation prefix "2", which never identifies a real product.
 */

export const CATEGORIES = [
  { slug: 'smartphones', name: 'Smartphones', icon: 'smartphone', risk: 'medium', desc: 'Mobile phones and smartphones' },
  { slug: 'laptops-computers', name: 'Laptops & computers', icon: 'laptop', risk: 'medium', desc: 'Laptops, desktops and all-in-one computers' },
  { slug: 'tablets', name: 'Tablets', icon: 'tablet', risk: 'medium', desc: 'Tablets and e-readers' },
  { slug: 'tvs-monitors', name: 'Televisions & monitors', icon: 'tv', risk: 'high', desc: 'Televisions, monitors and displays' },
  { slug: 'home-appliances', name: 'Home appliances', icon: 'washing-machine', risk: 'high', desc: 'Large household appliances' },
  { slug: 'kitchen-appliances', name: 'Small kitchen appliances', icon: 'coffee', risk: 'high', desc: 'Coffee makers, kettles, blenders, toasters' },
  { slug: 'audio', name: 'Audio equipment', icon: 'headphones', risk: 'medium', desc: 'Headphones, speakers, amplifiers' },
  { slug: 'accessories', name: 'Electronic accessories', icon: 'plug', risk: 'low', desc: 'Chargers, cables, controllers, peripherals' },
  { slug: 'small-industrial-equipment', name: 'Small industrial equipment', icon: 'factory', risk: 'high', desc: 'Power tools, compressors, small machinery' },
] as const;

export const SUBCATEGORIES = [
  { slug: 'refrigerators', name: 'Refrigerators & freezers', parent: 'home-appliances', risk: 'high' },
  { slug: 'washing-machines', name: 'Washing machines', parent: 'home-appliances', risk: 'high' },
  { slug: 'microwave-ovens', name: 'Microwave ovens', parent: 'home-appliances', risk: 'high' },
  { slug: 'coffee-makers', name: 'Coffee makers', parent: 'kitchen-appliances', risk: 'high' },
] as const;

/** compat: attributes the compatibility engine compares for this component type. */
export const COMPONENT_TYPES = [
  { slug: 'motherboard', name: 'Motherboard / logic board', risk: 'medium', compat: ['board_revision', 'connector_type'] },
  { slug: 'processor', name: 'Processor (CPU/SoC)', risk: 'medium', compat: ['socket'] },
  { slug: 'ram', name: 'Memory (RAM)', risk: 'medium', compat: ['form_factor', 'memory_type', 'speed_mts'] },
  { slug: 'storage', name: 'Storage (SSD/HDD)', risk: 'medium', compat: ['form_factor', 'interface'] },
  { slug: 'display-assembly', name: 'Display assembly', risk: 'medium', compat: ['size', 'resolution', 'connector_type'] },
  { slug: 'display-panel', name: 'Display panel', risk: 'medium', compat: ['size', 'resolution', 'connector_type', 'refresh_rate'] },
  { slug: 'backlight', name: 'Backlight', risk: 'medium', compat: ['connector_type'] },
  { slug: 'display-cable', name: 'Display cable', risk: 'medium', compat: ['connector_type', 'pin_count'] },
  { slug: 'battery', name: 'Battery', risk: 'medium', compat: ['chemistry', 'voltage', 'connector_type'] },
  { slug: 'cooling-system', name: 'Cooling system', risk: 'medium', compat: ['connector_type'] },
  { slug: 'fan', name: 'Fan', risk: 'medium', compat: ['connector_type', 'voltage'] },
  { slug: 'keyboard', name: 'Keyboard', risk: 'medium', compat: ['layout', 'connector_type'] },
  { slug: 'trackpad', name: 'Trackpad', risk: 'medium', compat: ['connector_type'] },
  { slug: 'power-connector', name: 'Power / charging connector', risk: 'medium', compat: ['connector_type'] },
  { slug: 'charger', name: 'Charger / power adapter', risk: 'low', compat: ['connector_type', 'voltage', 'power_w'] },
  { slug: 'wireless-module', name: 'Wireless module', risk: 'medium', compat: ['form_factor', 'interface'] },
  { slug: 'firmware', name: 'Firmware (BIOS/UEFI)', risk: 'low', compat: [] },
  { slug: 'power-supply-board', name: 'Power supply board', risk: 'high', compat: ['board_revision'] },
  { slug: 'mainboard-tv', name: 'TV main board', risk: 'high', compat: ['board_revision'] },
  { slug: 'tcon-board', name: 'Timing controller (T-con) board', risk: 'high', compat: ['board_revision'] },
  { slug: 'led-backlight-strips', name: 'LED backlight strips', risk: 'high', compat: ['strip_length', 'led_count', 'voltage'] },
  { slug: 'speakers', name: 'Speakers', risk: 'medium', compat: ['impedance', 'connector_type'] },
  { slug: 'charging-port', name: 'Charging port', risk: 'medium', compat: ['connector_type'] },
  { slug: 'camera', name: 'Camera module', risk: 'medium', compat: ['connector_type'] },
  { slug: 'heating-element', name: 'Heating element', risk: 'high', compat: ['voltage', 'power_w'] },
  { slug: 'thermal-fuse', name: 'Thermal fuse / cut-out', risk: 'high', compat: ['rated_temperature', 'rated_current'] },
  { slug: 'water-system', name: 'Water reservoir & tubing', risk: 'low', compat: [] },
  { slug: 'pump', name: 'Pump', risk: 'high', compat: ['voltage'] },
  { slug: 'magnetron', name: 'Magnetron', risk: 'high', compat: ['power_w'] },
  { slug: 'compressor', name: 'Compressor', risk: 'high', compat: ['refrigerant'] },
  { slug: 'motor', name: 'Motor', risk: 'high', compat: ['voltage', 'power_w'] },
  { slug: 'control-board', name: 'Control board', risk: 'high', compat: ['board_revision'] },
  { slug: 'casing', name: 'Casing / enclosure', risk: 'low', compat: [] },
  { slug: 'remote-control', name: 'Remote control', risk: 'low', compat: [] },
] as const;

export const CATEGORY_TEMPLATES: Record<string, string[]> = {
  'laptops-computers': ['motherboard', 'processor', 'ram', 'storage', 'display-assembly', 'battery', 'cooling-system', 'keyboard', 'trackpad', 'power-connector', 'wireless-module', 'charger'],
  smartphones: ['motherboard', 'display-assembly', 'battery', 'charging-port', 'camera', 'speakers', 'casing'],
  tablets: ['motherboard', 'display-assembly', 'battery', 'charging-port', 'camera', 'speakers'],
  'tvs-monitors': ['power-supply-board', 'mainboard-tv', 'tcon-board', 'display-panel', 'led-backlight-strips', 'speakers', 'remote-control'],
  'home-appliances': ['control-board', 'motor', 'pump', 'casing'],
  'kitchen-appliances': ['heating-element', 'thermal-fuse', 'control-board', 'casing'],
  'coffee-makers': ['heating-element', 'thermal-fuse', 'pump', 'water-system', 'control-board'],
  'microwave-ovens': ['magnetron', 'control-board', 'casing'],
  refrigerators: ['compressor', 'control-board', 'fan'],
  audio: ['speakers', 'battery', 'charging-port', 'control-board'],
  accessories: ['casing', 'power-connector'],
  'small-industrial-equipment': ['motor', 'control-board', 'casing'],
};

export const TOOLS = [
  ['flashlight', 'Flashlight', 'Any bright torch or phone light'],
  ['external-monitor', 'External monitor and cable', 'HDMI / USB-C / DisplayPort display'],
  ['precision-screwdrivers', 'Precision screwdriver set', 'Phillips, Torx and pentalobe bits as required by the device'],
  ['plastic-spudger', 'Plastic spudger / opening picks', 'Non-conductive prying tools'],
  ['antistatic-strap', 'Anti-static wrist strap', 'ESD protection'],
  ['multimeter', 'Digital multimeter', 'For continuity and voltage measurements'],
  ['compressed-air', 'Compressed air / soft brush', 'For removing dust'],
  ['isopropyl-alcohol', 'Isopropyl alcohol (90%+)', 'Cleaning contacts and residue'],
  ['thermal-paste', 'Thermal paste', 'Heat-transfer compound'],
  ['wooden-toothpick', 'Wooden toothpick', 'Non-conductive lint removal'],
  ['fireproof-container', 'Fire-resistant container (metal box with sand)', 'Safe storage for damaged batteries'],
  ['descaling-solution', 'Descaling solution', 'Manufacturer-approved descaler or citric acid'],
] as const;

// ─────────────────────────── Demonstration knowledge ───────────────────────────
type Sym = { slug: string; name: string; cat: string | null; syn: string[] };
export const SYMPTOMS: Sym[] = [
  { slug: 'powers-on', name: 'Device powers on (lights or fans)', cat: null, syn: ['turns on', 'powers on', 'power light on', 'fans spin', 'fan spins', 'boots up', 'lights come on', 'it starts'] },
  { slug: 'black-screen', name: 'Screen stays black', cat: null, syn: ['black screen', 'screen stays black', 'screen black', 'screen is black', 'no display', 'display blank', 'blank screen', 'nothing on screen', 'screen dark', 'screen stays dark'] },
  { slug: 'keyboard-lights-work', name: 'Keyboard lights work', cat: 'laptops-computers', syn: ['keyboard lights working', 'keyboard lights work', 'keyboard lights are working', 'keyboard backlight on', 'keyboard lights on', 'caps lock light', 'keyboard lit'] },
  { slug: 'no-power', name: 'No power at all', cat: null, syn: ["won't turn on", "doesn't turn on", 'does not turn on', 'no power', 'completely dead', 'no lights', 'not turning on', 'dead'] },
  { slug: 'unexpected-shutdown', name: 'Shuts down unexpectedly', cat: null, syn: ['shuts down', 'shuts off', 'turns off randomly', 'turns itself off', 'sudden shutdown', 'switches off'] },
  { slug: 'overheating', name: 'Gets very hot', cat: null, syn: ['overheating', 'overheats', 'very hot', 'gets hot', 'runs hot', 'too hot'] },
  { slug: 'loud-fan', name: 'Loud or grinding fan', cat: null, syn: ['loud fan', 'fan loud', 'fan noise', 'noisy fan', 'grinding fan', 'fan grinding', 'fan rattles'] },
  { slug: 'not-charging', name: 'Battery not charging', cat: null, syn: ['not charging', "won't charge", 'does not charge', "doesn't charge", 'battery not charging', 'plugged in not charging', 'charging stopped'] },
  { slug: 'battery-drains-fast', name: 'Battery drains quickly', cat: null, syn: ['battery drains fast', 'battery drains quickly', 'battery life short', 'drains quickly', 'battery dies quickly', 'poor battery life'] },
  { slug: 'flickering-screen', name: 'Screen flickers', cat: null, syn: ['flicker', 'flickers', 'flickering', 'screen flickers'] },
  { slug: 'lines-on-screen', name: 'Lines or artefacts on screen', cat: null, syn: ['lines on screen', 'vertical lines', 'horizontal lines', 'artifacts', 'artefacts', 'garbled image'] },
  { slug: 'beeps-on-startup', name: 'Beeps or blink codes at startup', cat: 'laptops-computers', syn: ['beeps', 'beeping', 'beep codes', 'blinking light pattern', 'blink code'] },
  { slug: 'liquid-spill', name: 'Liquid was spilled on it', cat: null, syn: ['spilled', 'spill', 'liquid', 'water damage', 'got wet', 'coffee on'] },
  { slug: 'swollen-battery', name: 'Swollen battery / bulging case', cat: null, syn: ['swollen battery', 'battery swollen', 'bulging', 'case bulging', 'trackpad lifted', 'screen lifting', 'back cover bulging'] },
  { slug: 'keys-not-working', name: 'Some keys do not work', cat: 'laptops-computers', syn: ['keys not working', 'keyboard not working', 'some keys', 'keys stuck', 'keys unresponsive'] },
  { slug: 'burning-smell', name: 'Burning smell or smoke', cat: null, syn: ['burning smell', 'smells burning', 'smell of burning', 'smoke', 'smoking'] },
  { slug: 'sound-works', name: 'Sound works', cat: 'tvs-monitors', syn: ['sound works', 'can hear sound', 'hear sound', 'audio works', 'sound is fine', 'has sound'] },
  { slug: 'no-picture', name: 'No picture', cat: 'tvs-monitors', syn: ['no picture', 'no image', 'picture gone', 'screen black'] },
  { slug: 'power-indicator-on', name: 'Power indicator is on', cat: 'tvs-monitors', syn: ['power light on', 'standby light on', 'red light on', 'power indicator on', 'indicator is on'] },
  { slug: 'slow-charging', name: 'Charges slowly or intermittently', cat: 'smartphones', syn: ['charges slowly', 'slow charging', 'charges intermittently', 'cable has to be held', 'loose charging', 'cable wiggle'] },
  { slug: 'cracked-screen', name: 'Cracked or shattered screen', cat: null, syn: ['cracked screen', 'screen cracked', 'shattered', 'broken glass', 'cracked display'] },
  { slug: 'touch-unresponsive', name: 'Touch not responding', cat: 'smartphones', syn: ['touch not working', 'touch unresponsive', 'touchscreen not working', 'ghost touch', 'touch not responding'] },
  { slug: 'not-heating', name: 'Does not heat', cat: 'kitchen-appliances', syn: ['not heating', "doesn't heat", 'does not heat', 'no heat', 'water cold', 'stays cold'] },
  { slug: 'slow-brewing', name: 'Brews slowly or weak flow', cat: 'coffee-makers', syn: ['brews slowly', 'slow brewing', 'weak flow', 'takes forever', 'drips slowly', 'slow to brew'] },
  { slug: 'leaking-water', name: 'Leaks water', cat: null, syn: ['leaks', 'leaking', 'water leaking', 'puddle'] },
];

type FM = {
  slug: string;
  name: string;
  desc: string;
  comp: string;
  cat: string;
  risk: 'low' | 'medium' | 'high';
  prior: number;
  symptoms: Record<string, number>;
};
export const FAILURE_MODES: FM[] = [
  // Laptops
  { slug: 'laptop-backlight-failure', name: 'Display backlight failure', desc: 'The panel draws an image but its backlight does not light it, so the screen looks black. A faint image is usually visible under a flashlight.', comp: 'backlight', cat: 'laptops-computers', risk: 'medium', prior: 1.2, symptoms: { 'black-screen': 0.85, 'powers-on': 0.92, 'keyboard-lights-work': 0.7, 'flickering-screen': 0.3 } },
  { slug: 'laptop-display-cable-fault', name: 'Loose or damaged display cable', desc: 'The flex cable between the mainboard and the display can loosen or wear at the hinge, interrupting the image or backlight signal.', comp: 'display-cable', cat: 'laptops-computers', risk: 'medium', prior: 1.0, symptoms: { 'black-screen': 0.7, 'powers-on': 0.92, 'keyboard-lights-work': 0.7, 'flickering-screen': 0.55, 'lines-on-screen': 0.4 } },
  { slug: 'laptop-lcd-panel-failure', name: 'LCD panel failure', desc: 'The panel itself has failed, often after impact or pressure damage.', comp: 'display-panel', cat: 'laptops-computers', risk: 'medium', prior: 0.9, symptoms: { 'black-screen': 0.5, 'powers-on': 0.92, 'keyboard-lights-work': 0.7, 'lines-on-screen': 0.6, 'cracked-screen': 0.4, 'flickering-screen': 0.25 } },
  { slug: 'laptop-ram-fault', name: 'Memory (RAM) fault or unseated module', desc: 'Faulty or poorly seated memory prevents the system from completing startup, so nothing is shown on any display.', comp: 'ram', cat: 'laptops-computers', risk: 'medium', prior: 1.0, symptoms: { 'black-screen': 0.8, 'powers-on': 0.9, 'keyboard-lights-work': 0.55, 'beeps-on-startup': 0.5 } },
  { slug: 'laptop-gpu-failure', name: 'Graphics (GPU) failure', desc: 'The graphics processor or its circuitry has failed. Board-level repair is usually required.', comp: 'motherboard', cat: 'laptops-computers', risk: 'medium', prior: 0.6, symptoms: { 'black-screen': 0.65, 'powers-on': 0.9, 'keyboard-lights-work': 0.6, 'lines-on-screen': 0.45, overheating: 0.3 } },
  { slug: 'laptop-firmware-corruption', name: 'Firmware (BIOS/UEFI) corruption', desc: 'Corrupted firmware, often after an interrupted update, stops the system from initialising the display.', comp: 'firmware', cat: 'laptops-computers', risk: 'low', prior: 0.4, symptoms: { 'black-screen': 0.7, 'powers-on': 0.85, 'keyboard-lights-work': 0.5 } },
  { slug: 'laptop-battery-degradation', name: 'Battery degradation', desc: 'Lithium-ion cells lose capacity with age and charge cycles, causing short runtime and shutdowns under load.', comp: 'battery', cat: 'laptops-computers', risk: 'medium', prior: 1.4, symptoms: { 'unexpected-shutdown': 0.55, 'battery-drains-fast': 0.85, 'not-charging': 0.25, 'powers-on': 0.8 } },
  { slug: 'laptop-charger-failure', name: 'Faulty charger or cable', desc: 'The external power adapter or its cable has failed.', comp: 'charger', cat: 'laptops-computers', risk: 'low', prior: 1.0, symptoms: { 'not-charging': 0.8, 'no-power': 0.4, 'unexpected-shutdown': 0.2 } },
  { slug: 'laptop-dc-jack-failure', name: 'Damaged power connector', desc: 'The charging socket or its solder joints are damaged, often after cable strain.', comp: 'power-connector', cat: 'laptops-computers', risk: 'medium', prior: 0.7, symptoms: { 'not-charging': 0.7, 'no-power': 0.45 } },
  { slug: 'laptop-thermal-clog', name: 'Clogged cooling system', desc: 'Dust build-up and dried thermal compound reduce cooling, leading to heat, fan noise and thermal shutdowns.', comp: 'cooling-system', cat: 'laptops-computers', risk: 'medium', prior: 1.2, symptoms: { overheating: 0.85, 'loud-fan': 0.6, 'unexpected-shutdown': 0.55, 'powers-on': 0.9 } },
  { slug: 'laptop-swollen-battery', name: 'Swollen lithium battery', desc: 'Gas build-up inside lithium cells deforms the battery. This is a fire hazard.', comp: 'battery', cat: 'laptops-computers', risk: 'high', prior: 0.4, symptoms: { 'swollen-battery': 0.95, 'battery-drains-fast': 0.5, 'keys-not-working': 0.15 } },
  { slug: 'laptop-liquid-damage', name: 'Liquid damage to mainboard', desc: 'Liquid causes corrosion and short circuits on the mainboard and keyboard.', comp: 'motherboard', cat: 'laptops-computers', risk: 'medium', prior: 0.5, symptoms: { 'liquid-spill': 0.95, 'no-power': 0.5, 'keys-not-working': 0.45, 'black-screen': 0.3 } },
  { slug: 'laptop-keyboard-failure', name: 'Keyboard failure', desc: 'The keyboard membrane or its connector has failed.', comp: 'keyboard', cat: 'laptops-computers', risk: 'medium', prior: 0.8, symptoms: { 'keys-not-working': 0.9, 'liquid-spill': 0.3, 'powers-on': 0.9 } },
  { slug: 'laptop-power-circuit-failure', name: 'Mainboard power circuit failure', desc: 'A fault in the mainboard power delivery circuitry prevents startup. Board-level diagnosis is required.', comp: 'motherboard', cat: 'laptops-computers', risk: 'medium', prior: 0.6, symptoms: { 'no-power': 0.8, 'not-charging': 0.3, 'burning-smell': 0.15 } },
  // TVs & monitors
  { slug: 'tv-backlight-failure', name: 'LED backlight failure', desc: 'One or more LED strips have failed; the TV has sound and a faint image visible with a flashlight.', comp: 'led-backlight-strips', cat: 'tvs-monitors', risk: 'high', prior: 1.5, symptoms: { 'no-picture': 0.9, 'black-screen': 0.9, 'sound-works': 0.85, 'power-indicator-on': 0.9 } },
  { slug: 'tv-power-supply-failure', name: 'Power supply board failure', desc: 'The power supply board does not deliver one or more voltages. Mains voltage is present on this board.', comp: 'power-supply-board', cat: 'tvs-monitors', risk: 'high', prior: 1.0, symptoms: { 'no-power': 0.7, 'no-picture': 0.6, 'black-screen': 0.6, 'sound-works': 0.2, 'power-indicator-on': 0.4 } },
  { slug: 'tv-tcon-failure', name: 'Timing controller (T-con) failure', desc: 'The T-con board drives the panel; failure causes no picture or distorted images while sound continues.', comp: 'tcon-board', cat: 'tvs-monitors', risk: 'high', prior: 0.6, symptoms: { 'no-picture': 0.6, 'black-screen': 0.5, 'sound-works': 0.8, 'lines-on-screen': 0.5, 'power-indicator-on': 0.9 } },
  { slug: 'tv-mainboard-failure', name: 'Main board failure', desc: 'The TV main board fails to process input signals.', comp: 'mainboard-tv', cat: 'tvs-monitors', risk: 'high', prior: 0.6, symptoms: { 'no-picture': 0.6, 'black-screen': 0.6, 'sound-works': 0.3, 'power-indicator-on': 0.8 } },
  { slug: 'tv-input-configuration', name: 'Input source or settings issue', desc: 'The selected input has no signal, or picture settings make the image appear absent.', comp: 'mainboard-tv', cat: 'tvs-monitors', risk: 'low', prior: 0.8, symptoms: { 'no-picture': 0.7, 'black-screen': 0.6, 'sound-works': 0.5, 'power-indicator-on': 0.95 } },
  // Smartphones
  { slug: 'phone-battery-degradation', name: 'Battery degradation', desc: 'Aged lithium-ion battery with reduced capacity.', comp: 'battery', cat: 'smartphones', risk: 'medium', prior: 1.5, symptoms: { 'battery-drains-fast': 0.9, 'unexpected-shutdown': 0.5, 'powers-on': 0.9 } },
  { slug: 'phone-port-debris', name: 'Debris in charging port', desc: 'Pocket lint packed into the charging port prevents the cable from seating fully.', comp: 'charging-port', cat: 'smartphones', risk: 'low', prior: 1.3, symptoms: { 'slow-charging': 0.85, 'not-charging': 0.55 } },
  { slug: 'phone-port-damage', name: 'Damaged charging port', desc: 'Worn or damaged charging port contacts.', comp: 'charging-port', cat: 'smartphones', risk: 'medium', prior: 0.8, symptoms: { 'slow-charging': 0.75, 'not-charging': 0.6, 'liquid-spill': 0.2 } },
  { slug: 'phone-display-damage', name: 'Display assembly damage', desc: 'Damaged display or digitizer after impact.', comp: 'display-assembly', cat: 'smartphones', risk: 'medium', prior: 1.2, symptoms: { 'cracked-screen': 0.9, 'touch-unresponsive': 0.5, 'lines-on-screen': 0.4, 'black-screen': 0.35 } },
  { slug: 'phone-swollen-battery', name: 'Swollen lithium battery', desc: 'Battery swelling pushes the display or back cover outwards. This is a fire hazard.', comp: 'battery', cat: 'smartphones', risk: 'high', prior: 0.4, symptoms: { 'swollen-battery': 0.95, 'touch-unresponsive': 0.2, 'battery-drains-fast': 0.5 } },
  // Coffee makers
  { slug: 'coffee-scale-buildup', name: 'Scale build-up', desc: 'Mineral deposits restrict water flow and reduce heating efficiency.', comp: 'water-system', cat: 'coffee-makers', risk: 'low', prior: 1.6, symptoms: { 'slow-brewing': 0.85, 'not-heating': 0.25, 'leaking-water': 0.15 } },
  { slug: 'coffee-thermal-fuse-open', name: 'Open thermal fuse', desc: 'A safety thermal fuse has opened, cutting power to the heating circuit. Mains voltage is present.', comp: 'thermal-fuse', cat: 'coffee-makers', risk: 'high', prior: 0.8, symptoms: { 'not-heating': 0.85, 'powers-on': 0.6 } },
  { slug: 'coffee-heating-element-failure', name: 'Heating element failure', desc: 'The heating element has failed open. Mains voltage is present.', comp: 'heating-element', cat: 'coffee-makers', risk: 'high', prior: 0.5, symptoms: { 'not-heating': 0.9, 'powers-on': 0.8 } },
];

type Probe = {
  slug: string;
  kind: 'question' | 'test';
  cat: string;
  risk: 'low' | 'medium' | 'high';
  prompt: string;
  help?: string;
  instructions?: string[];
  tools?: string[];
  options?: { value: string; label: string }[];
  effects: Record<string, Record<string, number>>; // answer -> fm slug -> LR
};
const YN = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
export const PROBES: Probe[] = [
  {
    slug: 'laptop-flashlight-test', kind: 'test', cat: 'laptops-computers', risk: 'low', tools: ['flashlight'],
    prompt: 'Shine a flashlight at the screen at an angle. Can you see a faint image?',
    help: 'Turn the laptop on, wait until it would normally show the desktop, then shine a bright light close to the screen in a dark room.',
    instructions: ['Power the laptop on and wait 60 seconds.', 'Darken the room.', 'Hold a flashlight close to the screen at a shallow angle and look for faint icons or text.'],
    effects: { yes: { 'laptop-backlight-failure': 9, 'laptop-display-cable-fault': 1.6, 'laptop-lcd-panel-failure': 0.3, 'laptop-ram-fault': 0.08, 'laptop-gpu-failure': 0.15, 'laptop-firmware-corruption': 0.1 }, no: { 'laptop-backlight-failure': 0.15, 'laptop-ram-fault': 1.4, 'laptop-gpu-failure': 1.3, 'laptop-lcd-panel-failure': 1.3, 'laptop-firmware-corruption': 1.3 } },
  },
  {
    slug: 'laptop-external-display-test', kind: 'test', cat: 'laptops-computers', risk: 'low', tools: ['external-monitor'],
    prompt: 'Connect an external monitor or TV. Does an image appear on it?',
    help: 'Use HDMI, DisplayPort or USB-C. Some laptops need a key combination (often Fn + a display key) to switch output.',
    instructions: ['Connect the external display and switch it to the right input.', 'Power on the laptop.', 'If nothing appears after a minute, try the display-switch key combination.'],
    effects: { yes: { 'laptop-backlight-failure': 2.2, 'laptop-display-cable-fault': 2.2, 'laptop-lcd-panel-failure': 2.2, 'laptop-ram-fault': 0.05, 'laptop-gpu-failure': 0.15, 'laptop-firmware-corruption': 0.1 }, no: { 'laptop-backlight-failure': 0.25, 'laptop-display-cable-fault': 0.25, 'laptop-lcd-panel-failure': 0.25, 'laptop-ram-fault': 2.2, 'laptop-gpu-failure': 2.2, 'laptop-firmware-corruption': 2.2 } },
  },
  {
    slug: 'laptop-beep-codes', kind: 'question', cat: 'laptops-computers', risk: 'low',
    prompt: 'Do you hear beeps or see a repeating blinking-light pattern when it starts?',
    effects: { yes: { 'laptop-ram-fault': 5, 'laptop-gpu-failure': 2, 'laptop-firmware-corruption': 1.5, 'laptop-backlight-failure': 0.5, 'laptop-display-cable-fault': 0.5, 'laptop-lcd-panel-failure': 0.5 }, no: { 'laptop-ram-fault': 0.7 } },
  },
  {
    slug: 'laptop-impact-history', kind: 'question', cat: 'laptops-computers', risk: 'low',
    prompt: 'Did the problem start after a drop, impact or pressure on the lid?',
    effects: { yes: { 'laptop-display-cable-fault': 3, 'laptop-lcd-panel-failure': 3.5, 'laptop-backlight-failure': 1.4 }, no: { 'laptop-display-cable-fault': 0.75, 'laptop-lcd-panel-failure': 0.6 } },
  },
  {
    slug: 'laptop-hinge-movement', kind: 'question', cat: 'laptops-computers', risk: 'low',
    prompt: 'Does the image appear briefly, or the screen flicker, when you move the lid to different angles?',
    effects: { yes: { 'laptop-display-cable-fault': 8, 'laptop-backlight-failure': 1.3 }, no: { 'laptop-display-cable-fault': 0.45 } },
  },
  {
    slug: 'laptop-firmware-update', kind: 'question', cat: 'laptops-computers', risk: 'low',
    prompt: 'Did the problem start right after a BIOS/firmware update, or an update that was interrupted?',
    effects: { yes: { 'laptop-firmware-corruption': 10 }, no: { 'laptop-firmware-corruption': 0.4 } },
  },
  {
    slug: 'laptop-reseat-ram', kind: 'test', cat: 'laptops-computers', risk: 'medium', tools: ['precision-screwdrivers', 'antistatic-strap'],
    prompt: 'With power and battery disconnected, reseat the memory modules. Does the laptop now display an image?',
    help: 'Only if your model has accessible memory slots. This requires opening the bottom cover.',
    instructions: ['Shut down, unplug the charger and disconnect the internal battery where possible.', 'Remove the bottom cover following your model’s service documentation.', 'Release the memory clips, remove each module, and reinsert firmly until the clips lock.', 'Reassemble and test.'],
    effects: { yes: { 'laptop-ram-fault': 12, 'laptop-backlight-failure': 0.1, 'laptop-display-cable-fault': 0.3, 'laptop-gpu-failure': 0.1 }, no: { 'laptop-ram-fault': 0.3 } },
  },
  {
    slug: 'laptop-runs-only-plugged', kind: 'question', cat: 'laptops-computers', risk: 'low',
    prompt: 'Does the laptop run only while plugged in, or shut down within minutes on battery?',
    effects: { yes: { 'laptop-battery-degradation': 5, 'laptop-thermal-clog': 0.6 }, no: { 'laptop-battery-degradation': 0.6 } },
  },
  {
    slug: 'laptop-shutdown-under-load', kind: 'question', cat: 'laptops-computers', risk: 'low',
    prompt: 'Do shutdowns happen mainly under heavy use (games, video, many tabs) even when plugged in?',
    effects: { yes: { 'laptop-thermal-clog': 5, 'laptop-battery-degradation': 0.8 }, no: { 'laptop-thermal-clog': 0.4, 'laptop-battery-degradation': 1.5 } },
  },
  {
    slug: 'laptop-other-charger', kind: 'test', cat: 'laptops-computers', risk: 'low',
    prompt: 'Try a different, compatible charger (or test yours on another device). Does it charge now?',
    effects: { yes: { 'laptop-charger-failure': 10, 'laptop-dc-jack-failure': 0.2, 'laptop-power-circuit-failure': 0.2 }, no: { 'laptop-charger-failure': 0.15 } },
  },
  {
    slug: 'laptop-swelling-check', kind: 'question', cat: 'laptops-computers', risk: 'low',
    prompt: 'Is the case, keyboard or trackpad bulging, lifted or no longer sitting flat?',
    help: 'Do not press on any bulging area.',
    effects: { yes: { 'laptop-swollen-battery': 25 }, no: { 'laptop-swollen-battery': 0.1 } },
  },
  {
    slug: 'tv-flashlight-test', kind: 'test', cat: 'tvs-monitors', risk: 'low', tools: ['flashlight'],
    prompt: 'With the TV on, shine a flashlight close to the screen. Can you see a faint image?',
    instructions: ['Turn the TV on and open a menu or input with a bright image.', 'Darken the room.', 'Shine a flashlight close to the screen at an angle.'],
    effects: { yes: { 'tv-backlight-failure': 10, 'tv-tcon-failure': 0.15, 'tv-mainboard-failure': 0.2, 'tv-input-configuration': 0.3, 'tv-power-supply-failure': 0.8 }, no: { 'tv-backlight-failure': 0.1, 'tv-tcon-failure': 1.5, 'tv-mainboard-failure': 1.5, 'tv-input-configuration': 1.2 } },
  },
  {
    slug: 'tv-sound-check', kind: 'question', cat: 'tvs-monitors', risk: 'low',
    prompt: 'Can you hear sound from the TV?',
    effects: { yes: { 'tv-backlight-failure': 2, 'tv-tcon-failure': 2, 'tv-input-configuration': 1.5, 'tv-power-supply-failure': 0.4, 'tv-mainboard-failure': 0.5 }, no: { 'tv-backlight-failure': 0.4, 'tv-tcon-failure': 0.4, 'tv-power-supply-failure': 2, 'tv-mainboard-failure': 1.8 } },
  },
  {
    slug: 'tv-power-indicator', kind: 'question', cat: 'tvs-monitors', risk: 'low',
    prompt: 'Is the power indicator light on?',
    effects: { yes: { 'tv-power-supply-failure': 0.6 }, no: { 'tv-power-supply-failure': 6, 'tv-backlight-failure': 0.3, 'tv-tcon-failure': 0.3, 'tv-input-configuration': 0.1 } },
  },
  {
    slug: 'tv-every-input', kind: 'question', cat: 'tvs-monitors', risk: 'low',
    prompt: 'Does the problem happen on every input, including the TV’s own menu?',
    effects: { yes: { 'tv-input-configuration': 0.05 }, no: { 'tv-input-configuration': 15, 'tv-backlight-failure': 0.1, 'tv-tcon-failure': 0.2, 'tv-power-supply-failure': 0.1 } },
  },
  {
    slug: 'tv-brief-image', kind: 'question', cat: 'tvs-monitors', risk: 'low',
    prompt: 'Does a picture appear for a second or two at power-on and then go dark?',
    effects: { yes: { 'tv-backlight-failure': 4, 'tv-power-supply-failure': 2 }, no: { 'tv-backlight-failure': 0.7 } },
  },
  {
    slug: 'phone-port-inspection', kind: 'test', cat: 'smartphones', risk: 'low', tools: ['flashlight'],
    prompt: 'Look into the charging port with a flashlight. Is there visible lint or debris?',
    effects: { yes: { 'phone-port-debris': 6, 'phone-port-damage': 0.8 }, no: { 'phone-port-debris': 0.2, 'phone-port-damage': 1.5 } },
  },
  {
    slug: 'phone-cable-test', kind: 'test', cat: 'smartphones', risk: 'low',
    prompt: 'Does a different known-good cable and charger charge normally?',
    effects: { yes: { 'phone-port-debris': 0.3, 'phone-port-damage': 0.3, 'phone-battery-degradation': 0.5 }, no: { 'phone-port-debris': 1.3, 'phone-port-damage': 1.5 } },
  },
  {
    slug: 'phone-swelling-check', kind: 'question', cat: 'smartphones', risk: 'low',
    prompt: 'Is the screen or back cover lifting away from the frame?',
    help: 'Do not press on it or try to push it back.',
    effects: { yes: { 'phone-swollen-battery': 25 }, no: { 'phone-swollen-battery': 0.1 } },
  },
  {
    slug: 'coffee-descale-test', kind: 'test', cat: 'coffee-makers', risk: 'low', tools: ['descaling-solution'],
    prompt: 'Run a full descaling cycle following the manufacturer’s instructions. Does brewing speed return to normal?',
    effects: { yes: { 'coffee-scale-buildup': 10 }, no: { 'coffee-scale-buildup': 0.3 } },
  },
  {
    slug: 'coffee-any-warmth', kind: 'question', cat: 'coffee-makers', risk: 'low',
    prompt: 'Does the water or the hot plate get warm at all?',
    effects: { yes: { 'coffee-scale-buildup': 2.5, 'coffee-thermal-fuse-open': 0.1, 'coffee-heating-element-failure': 0.1 }, no: { 'coffee-scale-buildup': 0.3, 'coffee-thermal-fuse-open': 2, 'coffee-heating-element-failure': 2 } },
  },
];

type Step = { title: string; body: string; expected?: string; caution?: string };
type Proc = {
  slug: string;
  fm: string;
  title: string;
  objective: string;
  difficulty: number;
  minutes: [number, number];
  risk: 'low' | 'medium' | 'high';
  tools: string[];
  comps: string[];
  prep: string[];
  safety: string[];
  verify: string[];
  reassembly: string[];
  steps: Step[];
};

const GENERIC_OPENING_SAFETY = [
  'Shut the device down fully and disconnect the charger.',
  'Disconnect the internal battery before touching any other connector, where the design allows.',
  'Work on a clean, static-safe surface and ground yourself.',
  'Screw positions and lengths vary by model — consult the manufacturer’s service documentation for your exact model.',
];

export const PROCEDURES: Proc[] = [
  {
    slug: 'laptop-reseat-memory', fm: 'laptop-ram-fault', title: 'Reseat or replace laptop memory modules',
    objective: 'Restore reliable contact between the memory modules and their slots, or isolate a faulty module.',
    difficulty: 2, minutes: [20, 45], risk: 'medium', tools: ['precision-screwdrivers', 'antistatic-strap', 'isopropyl-alcohol'], comps: ['ram'],
    prep: ['Back up data if the device still boots.', 'Confirm from the manufacturer’s specifications that your model has removable (not soldered) memory.'],
    safety: GENERIC_OPENING_SAFETY,
    verify: ['The laptop shows the manufacturer logo on its own screen.', 'The firmware setup screen reports the expected memory size.', 'Run the manufacturer’s memory diagnostic if available.'],
    reassembly: ['Refit the bottom cover, ensuring no cables are trapped.', 'Reinstall screws in their original positions.'],
    steps: [
      { title: 'Open the bottom cover', body: 'Remove the bottom cover following your model’s service documentation.', expected: 'Memory slots are visible, often under a shield.' },
      { title: 'Disconnect the battery', body: 'Disconnect the internal battery connector from the mainboard.', caution: 'Pull by the connector body, never the wires.' },
      { title: 'Remove the modules', body: 'Spread the retaining clips outward; the module tilts up. Pull it out at the same angle.', expected: 'The module pops up at about 30°.' },
      { title: 'Inspect and clean contacts', body: 'Check the gold contacts for corrosion. Clean gently with isopropyl alcohol on a lint-free cloth and let it dry.' },
      { title: 'Reinsert and test one module at a time', body: 'Insert one module fully at an angle, press down until the clips lock, reconnect the battery and test. Repeat with each module and slot to isolate a faulty module or slot.', expected: 'A working module/slot combination shows an image on start-up.' },
    ],
  },
  {
    slug: 'laptop-replace-display-panel', fm: 'laptop-lcd-panel-failure', title: 'Replace a laptop display panel',
    objective: 'Replace a failed LCD panel with a compatible panel.',
    difficulty: 3, minutes: [45, 90], risk: 'medium', tools: ['precision-screwdrivers', 'plastic-spudger', 'antistatic-strap'], comps: ['display-panel'],
    prep: ['Identify the exact panel part number from the label on the back of the existing panel, or from the manufacturer’s parts list.', 'Confirm the replacement matches size, resolution, connector type and pin count (use the compatibility checker).'],
    safety: [...GENERIC_OPENING_SAFETY, 'Display glass can crack; wear eye protection when removing a damaged panel.'],
    verify: ['Image is uniform with no lines or dead areas.', 'Brightness controls work across the full range.', 'Open and close the lid several times while observing the image.'],
    reassembly: ['Route the display cable exactly as it was originally routed.', 'Ensure the bezel clips seat fully all the way around.'],
    steps: [
      { title: 'Remove the display bezel', body: 'Starting at the bottom edge, gently release the bezel clips with a plastic opening tool. Some bezels are adhesive-mounted.', caution: 'Do not use metal tools against the panel.' },
      { title: 'Release the panel', body: 'Remove the screws holding the panel to the lid (if any) and tilt the panel forward onto the keyboard on a soft cloth.' },
      { title: 'Disconnect the panel cable', body: 'Peel back the tape over the connector on the back of the panel and pull the connector straight out.', expected: 'You can read the panel label and part number.' },
      { title: 'Fit the new panel', body: 'Connect the display cable to the new panel, secure the tape, and test before final assembly.', expected: 'An image appears with correct colours.' },
    ],
  },
  {
    slug: 'laptop-reseat-display-cable', fm: 'laptop-display-cable-fault', title: 'Inspect and reseat the laptop display cable',
    objective: 'Restore a reliable connection between the mainboard and the display.',
    difficulty: 3, minutes: [30, 75], risk: 'medium', tools: ['precision-screwdrivers', 'plastic-spudger', 'antistatic-strap'], comps: ['display-cable'],
    prep: ['Note whether the fault changes with lid angle — this suggests cable wear at the hinge.'],
    safety: GENERIC_OPENING_SAFETY,
    verify: ['Image is stable through the full range of lid movement.', 'No flicker when gently tapping the lid edge.'],
    reassembly: ['Route the cable along its original channel so it is not pinched by the hinge.'],
    steps: [
      { title: 'Open the base', body: 'Remove the bottom cover per your model’s service documentation and disconnect the battery.' },
      { title: 'Reseat the mainboard end', body: 'Locate the display connector on the mainboard, release any locking bar or tape, unplug and reconnect it firmly.', expected: 'Connector sits flush and level.' },
      { title: 'Inspect the cable', body: 'Look for kinks, pinch marks or worn insulation where the cable passes through the hinge.', expected: 'Visible wear indicates the cable needs replacing.' },
      { title: 'Test before closing', body: 'Reconnect the battery and test the display while moving the lid.' },
    ],
  },
  {
    slug: 'laptop-clean-vents', fm: 'laptop-thermal-clog', title: 'Clean laptop vents externally',
    objective: 'Remove dust from intake and exhaust vents to improve airflow.',
    difficulty: 1, minutes: [10, 20], risk: 'low', tools: ['compressed-air'], comps: ['cooling-system'],
    prep: ['Shut down and unplug the laptop.'],
    safety: ['Use short bursts of compressed air, holding the can upright.', 'Do not let the fan spin freely from the air stream — gently hold it still through the vent with a non-conductive tool if reachable, or use short bursts.'],
    verify: ['Fan noise under load is reduced.', 'Thermal shutdowns no longer occur under the same workload.'],
    reassembly: [],
    steps: [
      { title: 'Locate vents', body: 'Identify intake vents (often on the bottom) and exhaust vents (often at the rear or side).' },
      { title: 'Blow out dust', body: 'Use short bursts of compressed air into the exhaust vents, then the intake vents.', expected: 'Dust is expelled from the vents.' },
      { title: 'Test under load', body: 'Run a demanding task for 15 minutes and observe temperatures and fan behaviour.' },
    ],
  },
  {
    slug: 'laptop-swollen-battery-safety', fm: 'laptop-swollen-battery', title: 'Swollen battery: make safe and get professional replacement',
    objective: 'Reduce fire risk from a swollen lithium battery and arrange professional replacement.',
    difficulty: 4, minutes: [30, 60], risk: 'high', tools: ['fireproof-container'], comps: ['battery'],
    prep: ['Stop using and stop charging the device immediately.'],
    safety: ['Do not puncture, bend, press or pry a swollen battery.', 'Keep the device away from flammable materials.', 'If the battery is hot, hissing or smoking, move away and contact emergency services.'],
    verify: ['Professional confirms the new battery seats flat with no case deformation.'],
    reassembly: [],
    steps: [
      { title: 'Professional battery removal', body: 'A qualified technician removes the battery using controlled, non-puncturing methods and stores it in a fire-resistant container.' },
      { title: 'Install a compatible replacement', body: 'Fit a battery confirmed compatible by chemistry, voltage and connector.' },
      { title: 'Recycle the damaged battery', body: 'Take the swollen battery to a certified battery recycling point. Never put lithium batteries in household waste.' },
    ],
  },
  {
    slug: 'tv-backlight-strip-replacement', fm: 'tv-backlight-failure', title: 'Replace TV LED backlight strips',
    objective: 'Restore the backlight by replacing failed LED strips.',
    difficulty: 4, minutes: [90, 180], risk: 'high', tools: ['precision-screwdrivers', 'multimeter', 'antistatic-strap'], comps: ['led-backlight-strips'],
    prep: ['Identify strip part numbers from the strips themselves or the manufacturer’s service documentation.'],
    safety: ['Unplug the TV and wait for the power supply capacitors to discharge before opening.', 'The power supply board carries mains voltage.', 'Large panels are fragile; two people are needed to lift the panel.'],
    verify: ['Uniform brightness across the whole screen.', 'No flicker over a 30-minute soak test.'],
    reassembly: ['Replace all diffuser layers in their original order and orientation.'],
    steps: [
      { title: 'Open the rear cover', body: 'Lay the TV face-down on a padded surface and remove the rear cover.' },
      { title: 'Remove the panel layers', body: 'Remove the panel and diffuser layers to expose the LED strips, noting the order of each layer.' },
      { title: 'Test the strips', body: 'Test the strips with an LED tester suitable for the strip voltage to identify failed LEDs.' },
      { title: 'Replace the strips', body: 'Replace the complete strip set with matching part numbers rather than individual LEDs.' },
    ],
  },
  {
    slug: 'phone-clean-charging-port', fm: 'phone-port-debris', title: 'Clean a phone charging port',
    objective: 'Remove packed lint so the charging cable seats fully.',
    difficulty: 1, minutes: [5, 15], risk: 'low', tools: ['flashlight', 'wooden-toothpick'], comps: ['charging-port'],
    prep: ['Power the phone off.'],
    safety: ['Use only non-conductive tools (wood or plastic). Never use metal pins or needles.', 'Do not insert liquids into the port.'],
    verify: ['The cable clicks in firmly.', 'Charging starts immediately and stays connected when the cable is moved slightly.'],
    reassembly: [],
    steps: [
      { title: 'Inspect', body: 'Shine a flashlight into the port to see packed lint, usually at the back wall.' },
      { title: 'Loosen debris', body: 'Gently scrape along the back wall of the port with a wooden toothpick, avoiding the central contact tongue.', caution: 'Use light pressure — the contacts are delicate.', expected: 'Compressed lint comes out in a flat piece.' },
      { title: 'Test', body: 'Insert the cable and confirm it seats fully and charges.' },
    ],
  },
  {
    slug: 'coffee-descale', fm: 'coffee-scale-buildup', title: 'Descale a coffee maker',
    objective: 'Remove mineral deposits that restrict flow and reduce heating.',
    difficulty: 1, minutes: [30, 60], risk: 'low', tools: ['descaling-solution'], comps: ['water-system'],
    prep: ['Read the manufacturer’s descaling instructions for your model — some machines have a dedicated descaling program.'],
    safety: ['Do not open the appliance casing.', 'Use a descaler approved for your machine.'],
    verify: ['Brew time returns to normal.', 'Water reaches normal temperature.'],
    reassembly: [],
    steps: [
      { title: 'Prepare descaling solution', body: 'Mix the descaler as directed on the product.' },
      { title: 'Run the descaling cycle', body: 'Run the solution through the machine using the manufacturer’s descaling program or a normal brew cycle.' },
      { title: 'Rinse', body: 'Run at least two full cycles of clean water to flush residue.' },
    ],
  },
];

export const DEMO_DOC_TEXT = `REPAIRVERSE DEMONSTRATION NOTES — not verified documentation.

Section 1. Laptop display diagnostics.
When a laptop powers on but the internal screen remains black, first determine whether the system is producing a video signal at all. Connecting an external display separates display-assembly faults (backlight, panel, display cable) from faults that stop the system before video output (memory, graphics, firmware).

Section 2. Backlight check.
If a faint image is visible when a flashlight is shone at the screen, the panel is receiving an image and the backlight circuit is the likely fault. Backlight faults can originate in the panel's LED array, the display cable, or the backlight power circuit on the mainboard.

Section 3. Memory faults.
Many laptops signal memory initialisation failures with beep codes or repeating LED blink patterns. Reseating modules with the battery disconnected is a common first step where memory is removable.

Section 4. Safety.
Never press on, puncture or charge a swollen lithium battery. Devices with a swollen battery should be powered off and taken to a qualified technician.`;

// Fictional demonstration products.
export const DEMO_PRODUCTS = [
  {
    slug: 'demo-devices-aurora-14-ar14-23',
    category: 'laptops-computers',
    name: 'Aurora 14',
    model: 'AR14-23',
    year: 2023,
    description: 'Fictional 14-inch laptop used to demonstrate REPAIRVERSE workflows. All specifications are invented.',
    barcode: '2000000000015',
    variants: [
      { name: 'AR14-23 FHD', code: 'AR14-23-F', rev: 'Rev A', notes: '1920×1080 panel, 30-pin eDP' },
      { name: 'AR14-23 QHD', code: 'AR14-23-Q', rev: 'Rev B', notes: '2560×1440 panel, 40-pin eDP' },
    ],
    specs: [
      ['Display size', '14.0', 'in'],
      ['Memory type', 'DDR4 SO-DIMM', null],
      ['Battery', '11.55 V Li-ion', null],
      ['Charging connector', 'USB-C PD', null],
    ],
    components: [
      { comp: 'motherboard', name: 'Mainboard', attrs: { board_revision: 'AR14-MB-A' }, children: [
        { comp: 'processor', name: 'Processor (soldered)', attrs: {} },
        { comp: 'ram', name: 'Memory slots (2× SO-DIMM)', attrs: { form_factor: 'SO-DIMM', memory_type: 'DDR4', speed_mts: '3200' } },
        { comp: 'storage', name: 'M.2 SSD slot', attrs: { form_factor: 'M.2 2280', interface: 'NVMe' } },
        { comp: 'wireless-module', name: 'Wireless module', attrs: { form_factor: 'M.2 2230', interface: 'PCIe' } },
        { comp: 'power-connector', name: 'USB-C power input', attrs: { connector_type: 'USB-C' } },
      ] },
      { comp: 'display-assembly', name: 'Display assembly', attrs: { size: '14.0 in' }, children: [
        { comp: 'display-panel', name: 'LCD panel', attrs: { size: '14.0 in', resolution: '1920x1080', connector_type: 'eDP 30-pin', refresh_rate: '60 Hz' }, variant: 'AR14-23-F' },
        { comp: 'display-panel', name: 'LCD panel', attrs: { size: '14.0 in', resolution: '2560x1440', connector_type: 'eDP 40-pin', refresh_rate: '60 Hz' }, variant: 'AR14-23-Q' },
        { comp: 'display-cable', name: 'Display cable', attrs: { connector_type: 'eDP', pin_count: '30' }, variant: 'AR14-23-F' },
        { comp: 'backlight', name: 'Backlight (integrated in panel)', attrs: {} },
        { comp: 'camera', name: 'Webcam', attrs: {} },
      ] },
      { comp: 'battery', name: 'Battery', attrs: { chemistry: 'Li-ion', voltage: '11.55 V', connector_type: 'AR14 8-pin' } },
      { comp: 'cooling-system', name: 'Cooling system', attrs: {}, children: [{ comp: 'fan', name: 'Fan', attrs: { connector_type: '4-pin', voltage: '5 V' } }] },
      { comp: 'keyboard', name: 'Keyboard', attrs: { layout: 'US' } },
      { comp: 'trackpad', name: 'Trackpad', attrs: {} },
    ],
  },
  {
    slug: 'demo-devices-nimbus-x5-nx5',
    category: 'smartphones',
    name: 'Nimbus X5',
    model: 'NX5',
    year: 2024,
    description: 'Fictional smartphone used for demonstration. All specifications are invented.',
    barcode: '2000000000022',
    variants: [],
    specs: [['Charging connector', 'USB-C', null]],
    components: [
      { comp: 'motherboard', name: 'Logic board', attrs: {} },
      { comp: 'display-assembly', name: 'Display assembly', attrs: { size: '6.1 in', connector_type: 'NX5-DSP' } },
      { comp: 'battery', name: 'Battery', attrs: { chemistry: 'Li-ion', voltage: '3.87 V', connector_type: 'NX5-BAT' } },
      { comp: 'charging-port', name: 'USB-C charging port', attrs: { connector_type: 'USB-C' } },
      { comp: 'camera', name: 'Rear camera', attrs: {} },
      { comp: 'speakers', name: 'Loudspeaker', attrs: {} },
    ],
  },
  {
    slug: 'demo-devices-lumen-55-lm55',
    category: 'tvs-monitors',
    name: 'Lumen 55',
    model: 'LM55-4K',
    year: 2022,
    description: 'Fictional 55-inch LED television used for demonstration. All specifications are invented.',
    barcode: '2000000000039',
    variants: [],
    specs: [['Screen size', '55', 'in']],
    components: [
      { comp: 'power-supply-board', name: 'Power supply board', attrs: { board_revision: 'LM55-PSU-1' } },
      { comp: 'mainboard-tv', name: 'Main board', attrs: { board_revision: 'LM55-MB-2' } },
      { comp: 'tcon-board', name: 'T-con board', attrs: { board_revision: 'LM55-TC-1' } },
      { comp: 'display-panel', name: 'Panel', attrs: { size: '55 in', resolution: '3840x2160' } },
      { comp: 'led-backlight-strips', name: 'LED backlight strips (×10)', attrs: { strip_length: '540 mm', led_count: '6', voltage: '18 V' } },
      { comp: 'speakers', name: 'Speakers', attrs: { impedance: '8 ohm' } },
      { comp: 'remote-control', name: 'Remote control', attrs: {} },
    ],
  },
  {
    slug: 'demo-devices-brewmate-cm200',
    category: 'coffee-makers',
    name: 'BrewMate',
    model: 'CM-200',
    year: 2021,
    description: 'Fictional drip coffee maker used for demonstration. All specifications are invented.',
    barcode: '2000000000046',
    variants: [],
    specs: [],
    components: [
      { comp: 'heating-element', name: 'Heating element', attrs: {} },
      { comp: 'thermal-fuse', name: 'Thermal fuse', attrs: {} },
      { comp: 'water-system', name: 'Reservoir and tubing', attrs: {} },
      { comp: 'control-board', name: 'Control board', attrs: {} },
    ],
  },
] as const;

export const DEMO_PARTS = [
  { key: 'panel-fhd-oem', name: 'Aurora 14 FHD panel (OEM)', pn: 'DP-140F30', comp: 'display-panel', cls: 'oem', attrs: { size: '14.0 in', resolution: '1920x1080', connector_type: 'eDP 30-pin', refresh_rate: '60 Hz' } },
  { key: 'panel-generic-fhd', name: 'Generic 14.0" FHD panel', pn: 'GX140-FHD30', comp: 'display-panel', cls: 'aftermarket', attrs: { size: '14.0 in', resolution: '1920x1080', connector_type: 'eDP 30-pin', refresh_rate: '60 Hz' } },
  { key: 'panel-qhd', name: 'Aurora 14 QHD panel (OEM)', pn: 'DP-140Q40', comp: 'display-panel', cls: 'oem', attrs: { size: '14.0 in', resolution: '2560x1440', connector_type: 'eDP 40-pin', refresh_rate: '60 Hz' } },
  { key: 'panel-156', name: 'Generic 15.6" FHD panel', pn: 'GX156-FHD30', comp: 'display-panel', cls: 'aftermarket', attrs: { size: '15.6 in', resolution: '1920x1080', connector_type: 'eDP 30-pin', refresh_rate: '60 Hz' } },
  { key: 'battery-oem', name: 'Aurora 14 battery (OEM)', pn: 'AR14-BAT54', comp: 'battery', cls: 'oem', attrs: { chemistry: 'Li-ion', voltage: '11.55 V', connector_type: 'AR14 8-pin' } },
  { key: 'ram-8gb', name: '8 GB DDR4-3200 SO-DIMM', pn: 'SD4-8G-3200', comp: 'ram', cls: 'aftermarket', attrs: { form_factor: 'SO-DIMM', memory_type: 'DDR4', speed_mts: '3200' } },
  { key: 'display-cable-fhd', name: 'Aurora 14 display cable (30-pin)', pn: 'AR14-EDP30', comp: 'display-cable', cls: 'oem', attrs: { connector_type: 'eDP', pin_count: '30' } },
  { key: 'phone-battery', name: 'Nimbus X5 battery', pn: 'NX5-BAT-01', comp: 'battery', cls: 'oem', attrs: { chemistry: 'Li-ion', voltage: '3.87 V', connector_type: 'NX5-BAT' } },
] as const;

/** Explicit compatibility records (demo). variant: variant code or null for product-wide. */
export const DEMO_COMPAT = [
  { part: 'panel-fhd-oem', product: 'demo-devices-aurora-14-ar14-23', variant: 'AR14-23-F', state: 'confirmed', evidence: [{ kind: 'manufacturer_documentation', description: 'Listed as the original panel for the FHD variant in the (fictional) demo parts list.' }] },
  { part: 'panel-qhd', product: 'demo-devices-aurora-14-ar14-23', variant: 'AR14-23-Q', state: 'confirmed', evidence: [{ kind: 'manufacturer_documentation', description: 'Listed as the original panel for the QHD variant in the (fictional) demo parts list.' }] },
  { part: 'panel-qhd', product: 'demo-devices-aurora-14-ar14-23', variant: 'AR14-23-F', state: 'incompatible', evidence: [{ kind: 'technician_report', description: 'Different connector (40-pin vs 30-pin); the FHD variant’s display cable cannot drive this panel.' }] },
  { part: 'battery-oem', product: 'demo-devices-aurora-14-ar14-23', variant: null, state: 'confirmed', evidence: [{ kind: 'manufacturer_documentation', description: 'Original battery for all variants (fictional demo record).' }] },
  { part: 'display-cable-fhd', product: 'demo-devices-aurora-14-ar14-23', variant: 'AR14-23-F', state: 'confirmed', evidence: [{ kind: 'manufacturer_documentation', description: 'Original display cable for the FHD variant (fictional demo record).' }] },
  { part: 'phone-battery', product: 'demo-devices-nimbus-x5-nx5', variant: null, state: 'confirmed', evidence: [{ kind: 'manufacturer_documentation', description: 'Original battery (fictional demo record).' }] },
] as const;
