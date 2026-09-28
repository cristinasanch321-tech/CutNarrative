/* CutNarrative v8 - parte 1/2 */
function J(o) {
    var t = typeof o, k, i;
    if (o === null) return "null";
    if (t === "number") return (isNaN(o) || !isFinite(o)) ? "0" : String(o);
    if (t === "boolean") return String(o);
    if (t === "string") return '"' + o.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
                                       .replace(/\n/g, "\\n").replace(/\r/g, "") + '"';
    if (o instanceof Array) {
        var a = [];
        for (i = 0; i < o.length; i++) a.push(J(o[i]));
        return "[" + a.join(",") + "]";
    }
    var p = [];
    for (k in o) if (o.hasOwnProperty(k)) p.push('"' + k + '":' + J(o[k]));
    return "{" + p.join(",") + "}";
}
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function TC(frame, fps) {
    var nominal = Math.round(fps);
    var f = frame % nominal;
    var s = Math.floor(frame / nominal) % 60;
    var m = Math.floor(frame / (nominal * 60)) % 60;
    var h = Math.floor(frame / (nominal * 3600));
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s) + ":" + pad2(f);
}
function getZeroSec(seq) {
    try {
        var z = Number(seq.zeroPoint.ticks) / 254016000000;
        return isNaN(z) ? 0 : z;
    } catch (e) { return 0; }
}
function computeRealEnd(seq) {
    var end = 0;
    try { end = seq.end.seconds; } catch (e1) { end = 0; }
    var fromClips = 0, t;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        var tv = seq.videoTracks[t];
        if (tv.clips.numItems > 0) {
            var ce = tv.clips[tv.clips.numItems - 1].end.seconds;
            if (ce > fromClips) fromClips = ce;
        }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        var ta = seq.audioTracks[t];
        if (ta.clips.numItems > 0) {
            var ae = ta.clips[ta.clips.numItems - 1].end.seconds;
            if (ae > fromClips) fromClips = ae;
        }
    }
    if (end < fromClips - 0.5) end = fromClips;
    return end;
}
function CN_ping() {
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) return J({ ok: false, error: "No hay secuencia activa" });
        return J({ ok: true, seq: seq.name,
                   videoTracks: seq.videoTracks.numTracks,
                   audioTracks: seq.audioTracks.numTracks });
    } catch (e) { return J({ ok: false, error: e.toString() }); }
}
function CN_probe() {
    var res = {};
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { res.ok = false; res.error = "No hay secuencia activa"; return J(res); }
        res.ok = true;
        res.seq = seq.name;
        res.videoTracks = seq.videoTracks.numTracks;
        res.audioTracks = seq.audioTracks.numTracks;
        res.fps = Math.round((254016000000 / Number(seq.timebase)) * 1000) / 1000;
        res.zeroSec = getZeroSec(seq);
        res.seqEnd = Math.round(computeRealEnd(seq) * 1000) / 1000;
        res.tracks = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            var ti = { clips: tr.clips.numItems };
            if (tr.clips.numItems > 0)
                ti.rango = tr.clips[0].start.seconds.toFixed(1) + "s a " +
                           tr.clips[tr.clips.numItems - 1].end.seconds.toFixed(1) + "s";
            res.tracks.push(ti);
        }
        return J(res);
    } catch (e) { res.ok = false; res.error = e.toString(); return J(res); }
}
function CN_seek(tSec) {
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) return J({ ok: false, error: "No hay secuencia activa" });
        var tm = new Time();
        tm.seconds = Number(tSec);
        seq.setPlayerPosition(tm);
        return J({ ok: true });
    } catch (e) { return J({ ok: false, error: String(e) }); }
}
function CN_makeNamedCopy(src, newName) {
    var cl = null, how = "";
    try { cl = app.project.createNewSequenceFromSequence(newName, src); how = "createNew(nombre)"; } catch (e1) { cl = null; }
    if (!cl) {
        try { cl = src.clone(); how = "clone()"; } catch (e2) { cl = null; }
        if (cl) {
            try { cl.name = newName; } catch (eN) {}
            try {
                var root = app.project.rootItem;
                for (var i = 0; i < root.children.numItems; i++) {
                    if (root.children[i].name === cl.name && root.children[i].type === ProjectItemType.CLIP) {
                        try { root.children[i].name = newName; } catch (eR) {}
                        break;
                    }
                }
            } catch (eR2) {}
        }
    }
    return { seq: cl, how: how };
}
function CN_cloneSeq() {
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) return J({ ok: false, error: "No hay secuencia activa" });
        var r = CN_makeNamedCopy(seq, seq.name + " [CUTNARRATIVE]");
        if (!r.seq) return J({ ok: false, error: "No se pudo clonar" });
        try { app.project.activeSequence = r.seq; } catch (eA) {}
        return J({ ok: true, via: r.how, name: r.seq.name });
    } catch (e) { return J({ ok: false, error: String(e) }); }
}
function CN_execute(batchJson) {
    var res = { ok: false, cuts: 0, applied: 0, errorCount: 0, errors: [], clips: [] };
    function err(m) { res.errorCount++; if (res.errors.length < 15) res.errors.push(String(m)); }
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { res.errors.push("No hay secuencia activa"); return J(res); }
        var batch = eval("(" + batchJson + ")");
        if (!batch || !batch.segments || !batch.segments.length) { res.ok = true; return J(res); }
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) { res.errors.push("QE no disponible"); return J(res); }
        var fps = 254016000000 / Number(seq.timebase);
        var zeroSec = getZeroSec(seq);
        var dur0 = computeRealEnd(seq);
        var nV = Math.min(batch.tracks || seq.videoTracks.numTracks, seq.videoTracks.numTracks);
        var cutFrames = [], i, fr;
        for (i = 0; i < (batch.cuts || []).length; i++) {
            fr = Math.round((batch.cuts[i] + zeroSec) * fps);
            if (fr > 0 && (cutFrames.length === 0 || cutFrames[cutFrames.length - 1] !== fr)) cutFrames.push(fr);
        }
        for (var t = 0; t < nV; t++) {
            var qeT = qeSeq.getVideoTrackAt(t);
            for (var c = 0; c < cutFrames.length; c++) {
                try { qeT.razor(TC(cutFrames[c], fps)); res.cuts++; }
                catch (e) { err("razor p" + t + " f" + cutFrames[c] + ": " + e); }
            }
        }
        var segs = batch.segments;
        var firstS = segs[0].s;
        for (t = 0; t < nV; t++) {
            var domTrack = seq.videoTracks[t];
            var n = domTrack.clips.numItems;
            var toRemove = [], si = 0;
            for (c = 0; c < n; c++) {
                var clip = domTrack.clips[c];
                var mid = (clip.start.seconds + clip.end.seconds) / 2;
                if (mid < firstS) continue;
                while (si < segs.length - 1 && mid >= segs[si].e) si++;
                var chosen = segs[si].t;
                if (chosen === 0 || (chosen - 1) !== t) toRemove.push(clip);
            }
            for (c = toRemove.length - 1; c >= 0; c--) {
                try { toRemove[c].remove(false, true); res.applied++; }
                catch (eR) { err("lift p" + t + " c" + c + ": " + eR); }
            }
            res.clips.push((n - toRemove.length) + "/" + n);
        }
        res.dur0 = Math.round(dur0 * 10) / 10;
        try { res.dur1 = Math.round(computeRealEnd(seq) * 10) / 10; } catch (eD) {}
        if (typeof res.dur1 === "number" && Math.abs(res.dur1 - dur0) > 0.5) {
            res.errorCount++;
            res.errors.push("AVISO: la duracion cambio de " + dur0.toFixed(1) + "s a " + res.dur1.toFixed(1) + "s");
        }
        res.ok = true;
        return J(res);
    } catch (e) {
        res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")");
        return J(res);
    }
}
function CN_execute_file(path) {
    try {
        var f = new File(path);
        if (!f.exists) return J({ ok: false, errors: ["No existe: " + path] });
        f.encoding = "UTF-8";
        f.open("r");
        var data = f.read();
        f.close();
        return CN_execute(data);
    } catch (e) { return J({ ok: false, errors: ["CN_execute_file: " + e.toString()] }); }
}
function CN_addMarkers(batchJson) {
    var res = { ok: false, created: 0, errors: [] };
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { res.errors.push("No hay secuencia activa"); return J(res); }
        var batch = eval("(" + batchJson + ")");
        var zeroSec = getZeroSec(seq);
        var ms = batch.markers || [];
        for (var i = 0; i < ms.length; i++) {
            try {
                var m = seq.markers.createMarker(Number(ms[i].t) + zeroSec);
                if (m) {
                    m.name = String(ms[i].name || "Marker");
                    try { m.comments = String(ms[i].comment || ""); } catch (eC) {}
                    try { m.setColorByIndex(2); } catch (eCol) {}
                    res.created++;
                }
            } catch (e) { res.errors.push("marker @" + ms[i].t + "s: " + e); }
        }
        res.ok = true;
        return J(res);
    } catch (e) { res.errors.push("FATAL: " + e.toString()); return J(res); }
}
/* ---- parte 2/2 ---- */
function CN_extract(batchJson) {
    var res = { ok: false, kept: 0, removed: 0, markers: 0, totalKept: 0, dur0: 0, dur1: 0,
                errorCount: 0, errors: [], positions: [] };
    function err(m) { res.errorCount++; if (res.errors.length < 15) res.errors.push(String(m)); }
    var TOL = 0.05;
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { err("No hay secuencia activa"); return J(res); }
        var batch = batchJson;
        if (typeof batch === "string") { try { batch = eval("(" + batch + ")"); } catch (eB) { batch = null; } }
        var ranges = (batch && batch.ranges) ? batch.ranges : [];
        if (!ranges.length) { err("No hay tramos que mantener"); return J(res); }
        var wantDurInName = !!batch.durInName;
        var fps = 254016000000 / Number(seq.timebase);
        var zeroSec = getZeroSec(seq);
        var dur0 = computeRealEnd(seq);
        res.dur0 = Math.round(dur0 * 10) / 10;
        if (!isFinite(dur0) || dur0 <= 0) { err("No pude leer la duracion. NADA tocado."); return J(res); }
        ranges.sort(function (a, b) { return a.s - b.s; });
        var i;
        for (i = 0; i < ranges.length; i++) {
            if (ranges[i].s < -TOL || ranges[i].e > dur0 + TOL) {
                err("El tramo " + (i + 1) + " esta FUERA (dura " + dur0.toFixed(1) + "s). NADA tocado.");
                return J(res);
            }
            if (i > 0 && ranges[i].s < ranges[i - 1].e - TOL) {
                err("Los tramos " + i + " y " + (i + 1) + " se solapan. NADA tocado.");
                return J(res);
            }
        }
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq || qeSeq.name !== seq.name) {
            err("Desincronizacion DOM/QE. NADA tocado.");
            return J(res);
        }
        var seen = {}, bounds = [];
        function addB(t) {
            var fr = Math.round(t * fps);
            if (fr > 0 && fr < Math.round(dur0 * fps) && !seen[fr]) { seen[fr] = 1; bounds.push(fr); }
        }
        for (i = 0; i < ranges.length; i++) { addB(ranges[i].s); addB(ranges[i].e); }
        bounds.sort(function (a, b) { return a - b; });
        var razorFails = 0;
        for (var vt = 0; vt < seq.videoTracks.numTracks; vt++) {
            var qv = qeSeq.getVideoTrackAt(vt);
            for (i = 0; i < bounds.length; i++) {
                var did = false;
                for (var att = 0; att < 2 && !did; att++) {
                    try { qv.razor(TC(bounds[i], fps)); did = true; }
                    catch (eV) { if (att === 1) { razorFails++; err("razor V" + (vt + 1) + " @" + bounds[i] + ": " + eV); } }
                }
            }
        }
        for (var at = 0; at < seq.audioTracks.numTracks; at++) {
            var qa = qeSeq.getAudioTrackAt(at);
            for (i = 0; i < bounds.length; i++) {
                var did2 = false;
                for (var att2 = 0; att2 < 2 && !did2; att2++) {
                    try { qa.razor(TC(bounds[i], fps)); did2 = true; }
                    catch (eA) { if (att2 === 1) { razorFails++; err("razor A" + (at + 1) + " @" + bounds[i] + ": " + eA); } }
                }
            }
        }
        if (razorFails > 0) err("Aviso: " + razorFails + " cortes fallaron.");
        var rem = [], cur = 0;
        for (i = 0; i < ranges.length; i++) {
            if (ranges[i].s - cur > TOL) rem.push([cur, ranges[i].s]);
            cur = ranges[i].e;
        }
        if (dur0 - cur > TOL) rem.push([cur, dur0]);
        function clipsInRange(track, s, e) {
            var out = [], n = track.clips.numItems;
            for (var k = 0; k < n; k++) {
                var c = track.clips[k];
                if (c.end.seconds > s + TOL && c.start.seconds < e - TOL) out.push(c);
            }
            return out;
        }
        var aborted = false;
        for (i = rem.length - 1; i >= 0 && !aborted; i--) {
            var s = rem[i][0], e = rem[i][1];
            var all = [], partial = null, t2 = 0;
            for (t2 = 0; t2 < seq.videoTracks.numTracks && !partial; t2++) {
                var clV = clipsInRange(seq.videoTracks[t2], s, e);
                for (var kV = 0; kV < clV.length; kV++) {
                    if (clV[kV].start.seconds < s - TOL || clV[kV].end.seconds > e + TOL) {
                        partial = { tr: "V" + (t2 + 1), st: clV[kV].start.seconds, en: clV[kV].end.seconds };
                        break;
                    }
                    all.push(clV[kV]);
                }
            }
            for (t2 = 0; t2 < seq.audioTracks.numTracks && !partial; t2++) {
                var clA = clipsInRange(seq.audioTracks[t2], s, e);
                for (var kA = 0; kA < clA.length; kA++) {
                    if (clA[kA].start.seconds < s - TOL || clA[kA].end.seconds > e + TOL) {
                        partial = { tr: "A" + (t2 + 1), st: clA[kA].start.seconds, en: clA[kA].end.seconds };
                        break;
                    }
                    all.push(clA[kA]);
                }
            }
            if (partial) {
                err("ABORTADO: rango " + s.toFixed(1) + "-" + e.toFixed(1) + "s, clip en " + partial.tr +
                    " [" + partial.st.toFixed(2) + "-" + partial.en.toFixed(2) + "] no fue cortado. NADA borrado.");
                aborted = true;
                break;
            }
            if (!all.length) continue;
            for (var L = 0; L < all.length; L++) {
                var isFirst = (L === 0);
                try { all[L].remove(isFirst, !isFirst); res.removed++; }
                catch (eR) {
                    try { all[L].remove(false, true); res.removed++; }
                    catch (eR2) { err("borrar @" + s.toFixed(1) + "s: " + eR2); }
                }
            }
        }
        if (aborted) return J(res);
        var acc = 0;
        for (i = 0; i < ranges.length; i++) {
            var dur = ranges[i].e - ranges[i].s;
            try {
                var mk = seq.markers.createMarker(acc + zeroSec);
                if (mk) {
                    var note = ranges[i].note || ("Fragmento " + (i + 1));
                    var mkName = wantDurInName ? (note + "  [" + Math.round(dur) + "s]") : note;
                    try { mk.name = String(mkName).slice(0, 500); } catch (eN2) { try { mk.name = mkName; } catch (eN3) {} }
                    try { mk.comments = String(note); } catch (eC) {}
                    try { mk.setColorByIndex(2); } catch (eCol) {}
                    res.markers++;
                }
            } catch (eM) { err("marker " + (i + 1) + ": " + eM); }
            res.positions.push({ at: Math.round(acc * 100) / 100, dur: Math.round(dur * 100) / 100, note: ranges[i].note || "" });
            acc += dur;
            res.kept++;
        }
        res.totalKept = Math.round(acc * 100) / 100;
        try { res.dur1 = Math.round(computeRealEnd(seq) * 100) / 100; } catch (eD) {}
        if (res.dur1 && Math.abs(res.dur1 - res.totalKept) > 0.5)
            err("AVISO: duracion final " + res.dur1 + "s pero se esperaban " + res.totalKept + "s.");
        res.ok = (res.errorCount === 0);
        return J(res);
    } catch (e) {
        res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")");
        return J(res);
    }
}
function CN_buildCapsule(batchJson) {
    var res = { ok: false, placed: 0, markers: 0, total: 0, errorCount: 0, errors: [], positions: [] };
    function err(m) { res.errorCount++; if (res.errors.length < 15) res.errors.push(String(m)); }
    try {
        var batch = eval("(" + batchJson + ")");
        var rows = (batch && batch.rows) ? batch.rows.slice() : [];
        if (!rows.length) { err("No hay filas"); return J(res); }
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { err("No hay secuencia activa"); return J(res); }
        var v0 = seq.videoTracks[0];
        if (v0.clips.numItems < 1) { err("Sin clips en V1"); return J(res); }
        var zeroSec = getZeroSec(seq);
        var srcMap = [];
        for (var i = 0; i < v0.clips.numItems; i++) {
            var c = v0.clips[i];
            var pi = null;
            try { pi = c.projectItem; } catch (ePI) {}
            if (!pi) continue;
            var ms = 0;
            try { ms = c.inPoint.seconds; } catch (eI) {}
            srcMap.push({ start: c.start.seconds, end: c.end.seconds, mediaStart: ms, item: pi });
        }
        if (!srcMap.length) { err("Los clips de V1 no exponen projectItem."); return J(res); }
        function findSource(sec) {
            for (var k = 0; k < srcMap.length; k++)
                if (sec >= srcMap[k].start - 0.05 && sec <= srcMap[k].end + 0.05) return srcMap[k];
            return null;
        }
        var capName = batch.name || ("Cápsula " + new Date().toLocaleString());
        var newSeq = null;
        try { newSeq = app.project.createNewSequence(capName, ""); } catch (eN) { newSeq = null; }
        if (!newSeq) { err("No pude crear la secuencia nueva"); return J(res); }
        var cursor = 0;
        var audioWarns = 0;
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var src = findSource(row.s);
            if (!src) { err("fila " + (r + 1) + ": sin clip que cubra " + row.s.toFixed(2) + "s"); continue; }
            var dur = row.e - row.s;
            if (dur <= 0) { err("fila " + (r + 1) + ": OUT <= IN"); continue; }
            var item = src.item;
            try {
                var offset = row.s - src.start + src.mediaStart;
                item.setInPoint(offset, 4);
                item.setOutPoint(offset + dur, 4);
                newSeq.videoTracks[0].overwriteClip(item, cursor);
                try { newSeq.audioTracks[0].overwriteClip(item, cursor); }
                catch (eAU) { audioWarns++; }
                try { item.clearInPoint(4); } catch (e1) {}
                try { item.clearOutPoint(4); } catch (e2) {}
            } catch (eP) { err("fila " + (r + 1) + ": " + eP); continue; }
            try {
                var mk = newSeq.markers.createMarker(cursor);
                if (mk) {
                    var note = row.note || ("Cápsula " + (r + 1));
                    try { mk.name = String(note).slice(0, 500); } catch (eN) {}
                    try { mk.comments = String(note); } catch (eC) {}
                    try { mk.setColorByIndex(2); } catch (eCol) {}
                    res.markers++;
                }
            } catch (eK) { err("marker fila " + (r + 1) + ": " + eK); }
            res.positions.push({ at: Math.round(cursor * 100) / 100, dur: Math.round(dur * 100) / 100, note: row.note || "" });
            cursor += dur;
            res.placed++;
        }
        if (audioWarns > 0) err("Aviso: " + audioWarns + " sin audio por la API.");
        res.total = Math.round(cursor * 100) / 100;
        res.seqName = newSeq.name;
        try { app.project.activeSequence = newSeq; } catch (eA) {}
        res.ok = res.placed > 0;
        if (!res.placed) err("No se colocó ninguna fila");
        return J(res);
    } catch (e) {
        res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")");
        return J(res);
    }
}
function CN_buildCategoryBatch(batchJson) {
    var res = { ok: false, created: 0, seqs: [], errors: [], dry: false };
    function err(m) { res.errors.push(String(m)); }
    try {
        var batch = batchJson;
        if (typeof batch === "string") { try { batch = eval("(" + batch + ")"); } catch (eB) { batch = null; } }
        if (!batch || typeof batch !== "object" || !batch.categories) { err("Batch ilegible"); return J(res); }
        var cats = batch.categories;
        var dry = !!batch.dry;
        var src = null;
        var srcName = batch.sourceName || "";
        if (srcName) {
            for (var s = 0; s < app.project.sequences.numSequences; s++) {
                if (app.project.sequences[s].name === srcName) { src = app.project.sequences[s]; break; }
            }
        }
        if (!src) src = app.project.activeSequence;
        if (!src) { err("No hay secuencia fuente"); return J(res); }
        res.source = src.name;
        var srcEnd = computeRealEnd(src);
        if (!isFinite(srcEnd) || srcEnd <= 0) { err("No pude leer la duracion de la fuente"); return J(res); }
        for (var v = 0; v < cats.length; v++) {
            var catv = cats[v];
            var rgv = catv.ranges;
            if (typeof rgv === "string") { try { rgv = eval("(" + rgv + ")"); } catch (eV1) { rgv = null; } }
            if (!rgv || !rgv.length) { err(catv.name + ": 0 rangos"); continue; }
            for (var k = 0; k < rgv.length; k++) {
                if (rgv[k].e > srcEnd + 0.05) {
                    err(catv.name + ": el bloque " + (k + 1) + " acaba en " + rgv[k].e.toFixed(1) + "s pero la fuente dura " + srcEnd.toFixed(1) + "s");
                    return J(res);
                }
            }
        }
        if (dry) {
            res.dry = true;
            res.cats = [];
            for (var d = 0; d < cats.length; d++) {
                var rgd = cats[d].ranges;
                if (typeof rgd === "string") { try { rgd = eval("(" + rgd + ")"); } catch (eV2) { rgd = []; } }
                var tot = 0;
                for (var k2 = 0; k2 < rgd.length; k2++) tot += rgd[k2].e - rgd[k2].s;
                res.cats.push({ name: cats[d].name, blocks: rgd.length, dur: Math.round(tot * 100) / 100 });
            }
            res.ok = true;
            res.note = "SIMULACION: no se ha tocado nada";
            return J(res);
        }
        for (var c = 0; c < cats.length; c++) {
            var cat = cats[c];
            var rgc = cat.ranges;
            if (typeof rgc === "string") { try { rgc = eval("(" + rgc + ")"); } catch (eV3) { continue; } }
            try { app.project.activeSequence = src; } catch (eAct) {}
            var made = CN_makeNamedCopy(src, src.name + "_" + cat.name);
            if (!made.seq) { err("No pude clonar para " + cat.name); continue; }
            try { app.project.activeSequence = made.seq; } catch (eA) {}
            var payload = { ranges: rgc, durInName: true };
            var r = eval("(" + CN_extract(JSON.stringify(payload)) + ")");
            if (r && r.ok) {
                }
                res.created++;
                res.seqs.push({ name: made.seq.name, dur: r.dur1 });
            } else {
                err(made.seq.name + ": " + ((r && r.errors) ? r.errors.join(" | ") : "extract sin respuesta"));
            }
        }
        try { app.project.activeSequence = src; } catch (eBack) {}
        res.ok = res.created > 0;
        return J(res);
    } catch (e) {
        res.errors.push("FATAL: " + e.toString());
        return J(res);
    }
}

