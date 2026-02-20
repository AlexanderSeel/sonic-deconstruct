import { HalionParameter, EffectDef } from '../types';

export const generateHalionScript = (
    instrumentName: string, 
    params: HalionParameter[] | string[],
    effects?: EffectDef[],
    zoneType: string = "Synth"
): string => {
  // Handle legacy string array case
  const structuredParams: HalionParameter[] = params.map(p => {
    if (typeof p === 'string') {
        return { module: 'Unknown', parameter: 'Unknown', value: '0', description: p };
    }
    return p;
  }).filter(p => p.parameter !== 'Unknown');

  // Helper to sanitize values safely with unit parsing
  const cleanParams = structuredParams.map(p => {
    let val = p.value;
    let finalVal = val;

    // Intelligent Parsing logic
    const lowerVal = val.toLowerCase();
    if (lowerVal.endsWith('%')) {
        const num = parseFloat(val) / 100;
        if (!isNaN(num)) finalVal = num.toString();
    } else if (lowerVal.includes('db')) {
        finalVal = parseFloat(val).toString(); // Strip dB, use raw
    } else if (lowerVal.includes('ms')) {
        finalVal = parseFloat(val).toString(); // Strip ms
    } else if (lowerVal.includes('hz') || lowerVal.includes('khz')) {
        // Leave frequency as is if string, or parse if needed. 
        // HALion usually accepts numbers for Hz. 
        // If it's 20kHz, convert to 20000.
        if (lowerVal.includes('khz')) {
             const num = parseFloat(val) * 1000;
             if (!isNaN(num)) finalVal = num.toString();
        } else {
             finalVal = parseFloat(val).toString();
        }
    } else if (['on', 'true', 'yes'].includes(lowerVal)) {
        finalVal = '1';
    } else if (['off', 'false', 'no'].includes(lowerVal)) {
        finalVal = '0';
    } else {
        // Try parsing number
        const num = parseFloat(val);
        if (!isNaN(num) && isFinite(num)) finalVal = num.toString();
        else finalVal = `"${val}"`; // Wrap string enums in quotes
    }

    return { 
        ...p, 
        cleanValue: finalVal,
        originalValue: p.value
    };
  });

  // Helper for Effects Script Generation
  let effectsScript = "";
  if (effects && effects.length > 0) {
    effectsScript = `
print("----------------------------------------")
print("Setting up Effects Chain...")
local bus = program:getBus(1)
if bus then
    ${effects.map(fx => {
        let halionClass = "Studio EQ"; 
        const typeLower = fx.type.toLowerCase();
        
        if (typeLower.includes("reverb")) halionClass = "Reverb";
        else if (typeLower.includes("delay")) halionClass = "Multi Delay";
        else if (typeLower.includes("distort") || typeLower.includes("drive")) halionClass = "Distortion";
        else if (typeLower.includes("chorus")) halionClass = "Studio Chorus";
        else if (typeLower.includes("flanger")) halionClass = "Flanger";
        else if (typeLower.includes("phaser")) halionClass = "Phaser";
        else if (typeLower.includes("compressor")) halionClass = "Compressor";
        else if (typeLower.includes("eq")) halionClass = "Studio EQ";
        else if (typeLower.includes("amp")) halionClass = "Guitar Amp";
        else if (typeLower.includes("filter")) halionClass = "Auto Filter";
        
        return `
    local status, newFx = pcall(function() return bus:appendEffect("${halionClass}") end)
    if status and newFx then
        print(">> Added Effect: " .. newFx.name)
        ${fx.parameters.map(p => {
            let val = parseFloat(p.value.replace(/[^0-9.-]/g, ''));
            if (isNaN(val)) val = 0.5;
            
            // Effect Parameter Cleanup
            let pName = p.name;
            if (pName.match(/mix|wet/i)) pName = "Mix";
            if (pName.match(/time|delay/i)) pName = "DelayTime";
            if (pName.match(/feed|repeat/i)) pName = "Feedback";
            if (pName.match(/drive|dist/i)) pName = "Drive";
            if (pName.match(/rate|speed/i)) pName = "Rate";
            if (pName.match(/depth|amount/i)) pName = "Depth";
            if (pName.match(/room|size/i)) pName = "RoomSize";
            
            return `        pcall(function() newFx:setParameter("${pName}", ${val}) end)`;
        }).join('\n')}
    end`;
    }).join('\n')}
else
    print(">> Warning: No Master Bus found to attach effects.")
end
`;
  }

  // Determine Zone Class and Specific Aliases based on Analysis
  let zoneClassName = "Synth Zone";
  let specificAliases = "";

  if (zoneType === "Sample") {
    zoneClassName = "Sample Zone";
    specificAliases = `
    -- SAMPLE OSCILLATOR
    ["Root Key"]        = {"SampleOsc.RootKey", "RootKey", "Sample.RootKey"},
    ["Loop Mode"]       = {"SampleOsc.LoopMode", "Sample.LoopMode", "Loop"},
    ["Sample Start"]    = {"SampleOsc.SampleStart", "Sample.Start"},
    ["Sample End"]      = {"SampleOsc.SampleEnd", "Sample.End"},
    ["Loop Start"]      = {"SampleOsc.LoopStart", "Sample.LoopStart"},
    ["Loop End"]        = {"SampleOsc.LoopEnd", "Sample.LoopEnd"},
    ["Playback Quality"]= {"SampleOsc.Quality", "Sample.PlaybackQuality", "Quality"},
    ["Pitch Key Follow"]= {"SampleOsc.PitchKeyFollow", "KeyFollow"},
    `;
  } else if (zoneType === "Granular") {
    zoneClassName = "Granular Zone";
    specificAliases = `
    -- GRANULAR OSCILLATOR
    ["Position"]        = {"GrainOsc.Position", "Granular.Position", "Pos"},
    ["Duration"]        = {"GrainOsc.Duration", "Granular.Duration", "Grain Dur"},
    ["Speed"]           = {"GrainOsc.Speed", "Granular.Speed"},
    ["Pitch"]           = {"GrainOsc.Pitch", "Granular.Pitch"},
    ["Formant"]         = {"GrainOsc.Formant", "Granular.Formant"},
    ["Grain Shape"]     = {"GrainOsc.Shape", "Granular.Shape"},
    ["Random Position"] = {"GrainOsc.PositionRandom", "Granular.PositionRandom"},
    ["Random Pitch"]    = {"GrainOsc.PitchRandom", "Granular.PitchRandom"},
    ["Direction"]       = {"GrainOsc.Direction", "Granular.Direction"},
    ["Multi Count"]     = {"GrainOsc.MultiCount", "Granular.Multi"},
    `;
  } else if (zoneType === "Wavetable") {
    zoneClassName = "Wavetable Zone";
    specificAliases = `
    -- WAVETABLE OSCILLATOR
    ["Position"]        = {"WavetableOsc.Position", "Wavetable.Position", "Index"},
    ["Speed"]           = {"WavetableOsc.Speed", "Wavetable.Speed"},
    ["Formant"]         = {"WavetableOsc.Formant", "Wavetable.Formant"},
    ["Multi Count"]     = {"WavetableOsc.MultiCount", "Wavetable.MultiOsc", "Multi"},
    ["Multi Detune"]    = {"WavetableOsc.MultiDetune", "Wavetable.Detune"},
    ["Multi Spread"]    = {"WavetableOsc.MultiSpread", "Wavetable.Spread"},
    ["Phase"]           = {"WavetableOsc.Phase", "Phase"},
    ["Direction"]       = {"WavetableOsc.Direction", "Wavetable.Dir"},
    `;
  } else {
    // Synth (Default)
    specificAliases = `
    -- ANALOG SYNTH OSCILLATORS
    ["Osc 1.Waveform"]  = {"SynthOsc.Osc1.Waveform", "Osc 1.Waveform", "Osc 1.Type"},
    ["Osc 1.Level"]     = {"SynthOsc.Osc1.Level", "Osc 1.Level", "Osc 1.Vol"},
    ["Osc 1.Pan"]       = {"SynthOsc.Osc1.Pan", "Osc 1.Pan"},
    ["Osc 1.Coarse"]    = {"SynthOsc.Osc1.Coarse", "Osc 1.Coarse", "Osc 1.Pitch"},
    ["Osc 1.Fine"]      = {"SynthOsc.Osc1.Fine", "Osc 1.Fine", "Osc 1.Detune"},
    ["Osc 1.Multi"]     = {"SynthOsc.Osc1.MultiCount", "Osc 1.Multi", "Osc 1.Unison"},
    
    ["Osc 2.Waveform"]  = {"SynthOsc.Osc2.Waveform", "Osc 2.Waveform", "Osc 2.Type"},
    ["Osc 2.Level"]     = {"SynthOsc.Osc2.Level", "Osc 2.Level", "Osc 2.Vol"},
    ["Osc 2.Pan"]       = {"SynthOsc.Osc2.Pan", "Osc 2.Pan"},
    ["Osc 2.Coarse"]    = {"SynthOsc.Osc2.Coarse", "Osc 2.Coarse", "Osc 2.Pitch"},
    ["Osc 2.Fine"]      = {"SynthOsc.Osc2.Fine", "Osc 2.Fine", "Osc 2.Detune"},
    ["Osc 2.Multi"]     = {"SynthOsc.Osc2.MultiCount", "Osc 2.Multi", "Osc 2.Unison"},

    ["Osc 3.Waveform"]  = {"SynthOsc.Osc3.Waveform", "Osc 3.Waveform"},
    ["Osc 3.Level"]     = {"SynthOsc.Osc3.Level", "Osc 3.Level"},

    ["Sub.Level"]       = {"SynthOsc.Sub.Level", "Sub Osc.Level", "Sub.Level"},
    ["Sub.Waveform"]    = {"SynthOsc.Sub.Waveform", "Sub Osc.Waveform"},
    
    ["Noise.Level"]     = {"SynthOsc.Noise.Level", "Noise.Level"},
    ["Noise.Color"]     = {"SynthOsc.Noise.Color", "Noise.Color"},
    
    ["Ring Mod.Level"]  = {"SynthOsc.RingMod.Level", "RingMod.Level"},
    `;
  }

  return `
-- Auto-generated HALion Script for ${instrumentName}
-- Zone Type: ${zoneType}
-- Class: ${zoneClassName}
-- Generated by Sonic Deconstruct

local valueMap = {
    ["sine"] = 0, ["sin"] = 0, ["triangle"] = 1, ["tri"] = 1,
    ["saw"] = 2, ["sawtooth"] = 2, ["pulse"] = 3, ["square"] = 3,
    ["noise"] = 4, 
    ["on"] = 1, ["off"] = 0, ["true"] = 1, ["false"] = 0,
    ["continuous"] = 0, ["alternate"] = 1, ["once"] = 2, ["until release"] = 3,
    ["lp24"] = 0, ["lowpass"] = 0, ["low pass"] = 0,
    ["bp12"] = 2, ["bandpass"] = 2, ["band pass"] = 2,
    ["hp24"] = 4, ["highpass"] = 4, ["high pass"] = 4
}

-- DYNAMIC PARAMETER MAPPING
local aliases = {
    -- COMMON FILTER & ENV
    ["Filter.Cutoff"]    = {"Filter.Cutoff", "DCF.Cutoff", "Filter.Freq", "Zone.Filter.Cutoff"},
    ["Filter.Resonance"] = {"Filter.Resonance", "DCF.Resonance", "Filter.Q", "Zone.Filter.Resonance"},
    ["Filter.Type"]      = {"Filter.Type", "Filter.Shape", "Filter.Mode", "Zone.Filter.Type"},
    ["Filter.EnvAmount"] = {"Filter.EnvelopeAmount", "Filter.EnvAmount", "DCF.EnvAmount", "Zone.Filter.EnvelopeAmount"},
    ["Filter.Morph"]     = {"Filter.Morph", "Filter.ShapeMorph"},
    ["Filter.Drive"]     = {"Filter.Drive", "Filter.Distortion"},

    ["Amp Env.Attack"]  = {"Amp Env.Attack", "DCA.Attack", "Zone.Amp Env.Attack", "Amp.Attack", "Env.Attack"},
    ["Amp Env.Decay"]   = {"Amp Env.Decay", "DCA.Decay", "Zone.Amp Env.Decay", "Amp.Decay", "Env.Decay"},
    ["Amp Env.Sustain"] = {"Amp Env.Sustain", "DCA.Sustain", "Zone.Amp Env.Sustain", "Amp.Sustain", "Env.Sustain"},
    ["Amp Env.Release"] = {"Amp Env.Release", "DCA.Release", "Zone.Amp Env.Release", "Amp.Release", "Env.Release"},
    
    ["Filter Env.Attack"] = {"Filter Env.Attack", "DCF.Attack", "Zone.Filter Env.Attack"},
    ["Filter Env.Decay"]  = {"Filter Env.Decay", "DCF.Decay", "Zone.Filter Env.Decay"},
    ["Filter Env.Sustain"]= {"Filter Env.Sustain", "DCF.Sustain", "Zone.Filter Env.Sustain"},
    ["Filter Env.Release"]= {"Filter Env.Release", "DCF.Release", "Zone.Filter Env.Release"},

    ["User Env.Attack"]   = {"UserEnv.Attack", "User.Attack"},
    ["User Env.Decay"]    = {"UserEnv.Decay", "User.Decay"},
    ["User Env.Sustain"]  = {"UserEnv.Sustain", "User.Sustain"},
    ["User Env.Release"]  = {"UserEnv.Release", "User.Release"},
    
    ["Pitch Env.Attack"]  = {"PitchEnv.Attack", "Pitch.Attack"},
    ["Pitch Env.Decay"]   = {"PitchEnv.Decay", "Pitch.Decay"},

    -- LFOs
    ["LFO 1.Freq"]       = {"LFO1.Freq", "LFO 1.Rate", "LFO 1.Speed"},
    ["LFO 1.Shape"]      = {"LFO1.Shape", "LFO 1.Waveform"},
    ["LFO 2.Freq"]       = {"LFO2.Freq", "LFO 2.Rate", "LFO 2.Speed"},
    ["LFO 2.Shape"]      = {"LFO2.Shape", "LFO 2.Waveform"},

    ${specificAliases}
}

function resolveValue(val)
    if type(val) == "string" then
        local lower = string.lower(val)
        if valueMap[lower] then return valueMap[lower] end
    end
    return val
end

function findValidParameter(zone, param)
    local function exists(p)
        local status, res = pcall(function() return zone:getParameter(p) end)
        return status and res ~= nil
    end

    if exists(param) then return param end
    
    -- Check Aliases
    if aliases[param] then
        for _, alias in ipairs(aliases[param]) do
            if exists(alias) then return alias end
        end
    end
    
    -- Fallback: Check if prefixing with Synth/Sample helps (older HALion versions sometimes required strict paths)
    if exists("Synth." .. param) then return "Synth." .. param end
    
    -- Rough cleanup check (remove spaces)
    local noSpace = string.gsub(param, " ", "")
    if exists(noSpace) then return noSpace end
    
    return nil
end

local program = this.program
if not program then return end

print("Sonic Deconstruct: Setup for ${instrumentName}")

-- Create or Find Zone
local zones = program:findZones(true)
local zone = nil

-- Try to find existing matching zone type
for i = 1, #zones do
    if zones[i].name:find("${zoneType}") or zones[i].className == "${zoneClassName}" then
        zone = zones[i]
        break
    end
end

if not zone then
    print("Creating new ${zoneClassName}...")
    local ok, newZone = pcall(function() return program:appendZone("${zoneClassName}") end)
    if ok and newZone then 
        zone = newZone 
        zone:setName("${instrumentName} ${zoneType}")
        print(">> Zone Created Successfully.")
    else 
        print(">> ERROR: Failed to create zone type: ${zoneClassName}")
        -- Fallback to first available zone if creation fails (e.g. strict permissions)
        if #zones > 0 then 
            zone = zones[1] 
            print(">> Fallback to existing zone: " .. zone.name)
        else
            return 
        end
    end
end

print("Applying Parameters to " .. zone.name .. "...")
${cleanParams.map(p => `
pcall(function() 
    local validParam = findValidParameter(zone, "${p.parameter}")
    if validParam then
        -- Clean Value: ${p.cleanValue} (Original: ${p.originalValue})
        local val = resolveValue(${p.cleanValue})
        zone:setParameter(validParam, val) 
        print("  [OK] Set " .. validParam .. " = " .. tostring(val))
    else
        print("  [FAIL] Param not found: ${p.parameter}")
    end
end)`).join('\n')}

${effectsScript}

print("Done.")
`;
};