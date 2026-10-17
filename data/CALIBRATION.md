# Sensor calibration

The simulator is still synthetic (faults must be injectable on demand), but the pump P1 and the conveyor motor K1 are calibrated on public measured datasets. F1 and C1 have no public sensor dataset and stay on typical values written in their (synthetic) manuals.

| Machine | Source | What we took |
| --- | --- | --- |
| P1 centrifugal pump | [SKAB – Skoltech Anomaly Benchmark](https://github.com/waico/SKAB) (GPL-3.0, DOI 10.34740/KAGGLE/DSV/1693952): water-pump testbed, 1 Hz | Relative noise, fault signature and ramp time |
| P1 vibration limits | ISO 10816-1, class I (machines up to 15 kW) | Thresholds 1.8 / 4.5 mm/s |
| K1 conveyor motor | [Electric Motor Temperature](https://www.kaggle.com/datasets/wkirgsn/electric-motor-temperature) (Kaggle, Paderborn University): 52 kW PMSM test bench, 2 Hz, 185 h | Sensor noise, maximum heating rate |
| P1, K1 current | Nameplate estimate I = P / (√3 · 400 V · η · cos φ) | 7.5 kW → ~14.5 A, 1.1 kW → ~2.6 A |
| F1 filler, C1 capper | No public dataset found | Unchanged, values from the manuals |

Datasets are not redistributed in this repo. Reproduce with `node scripts/calibration/skab_stats.mjs <SKAB>/data`, `skab_ramp.mjs <csv> <column>` and `emt_stats.mjs measures_v2.csv`.

## P1 – SKAB findings

The testbed is small (≈2.4 A motor, vibration in g RMS), so only **relative** values are transferred, not absolute ones.

- Healthy vibration: short-term noise 0.5–0.6 % of the mean, overall std ≈ 2 % → noise 0.05 mm/s on a 1.3 mm/s baseline.
- Rotor imbalance (files `other/5–9`): vibration ×2.5–3.0 (+150–210 %), 24–115 σ above normal, while temperature, flow and current stay within ±1–2 %.
- Ramp of linear/exponential imbalance: ×1.5–1.7 after 10 s, ×1.9–2.0 after 30 s, ×2.7–3.0 after 60 s → **+0.045 mm/s per second** from 1.3 mm/s.
- Cavitation by draining (`other/12`): flow −60 % to −80 % with almost no vibration change. Hot water supply (`other/14`): fluid temperature +16 % in 60 s.
- Not usable: SKAB current, voltage and pressure are dominated by measurement noise (pressure std is 2× its mean).

SKAB has no bearing-wear experiment: the `p1-bearing` vibration ramp reuses the imbalance ramp, and the bearing temperature rate (0.25 °C/s) is bounded by the motor heating rates below.

## K1 – Electric Motor Temperature findings

- Stator winding sensor noise: 0.06 °C per sample → noise 0.3 °C on a housing sensor (wider band than a winding probe).
- Heating rate over 60 s windows: median 0, p90 0.09, p99 0.27, **max 0.73 °C/s** under the heaviest load profiles. The old K1 rate (1.4 °C/s) was twice the maximum ever measured; the new rate is 0.7 °C/s (blocked cooling at full load).
- Steady temperature rise above coolant: 15–35 K at partial load, up to ~90 K at the highest currents.

## Resulting timeline (from fault injection)

Yellow is the statistical early warning (|z| > 2.5 or above the warning limit): it already opens the incident and starts the AI analysis. Red means the absolute (ISO / manual) limit is exceeded and triggers a **protective trip of the whole serial line**, which restarts when the work order is closed (repair) or manually. Measured with the simulator + anomaly engine (seed 7):

| Fault | Yellow (early warning) | Red ⇒ line stop |
| --- | --- | --- |
| `p1-bearing` | P1 at 0–2 s, F1 at 10 s, C1 at 18 s (cascade) | P1 vibration > 4.5 mm/s at ~70 s |
| `k1-overheat` | K1 at 0–2 s | > 80 °C at ~44 s, avoided if the autonomous "reduce speed" runs first |
| `c1-torque` | C1 at 2 s | > 3.2 Nm at ~25 s |

Pitch line: the AI diagnosis is ready about 60 s before the pump would trip the line; approving and repairing in that window avoids the stop (190 €/min for the whole line).
