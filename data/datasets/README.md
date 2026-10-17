# Synthetic sensor datasets (bottling line)

**Synthetic, generated** by `npx tsx scripts/generate-datasets.ts` (deterministic, seed 2026). Parameters come from public measured data and standards, see [../CALIBRATION.md](../CALIBRATION.md). 48 h starting 2026-10-12 00:00 UTC, one sample every 10 s (17,280 rows per machine).

| File | Machine | Columns |
| --- | --- | --- |
| `p1-pump.csv` | P1 centrifugal pump, 7.5 kW | `vib_mm_s`, `bearing_temp_c`, `current_a`, `flow_m3h` |
| `f1-filler.csv` | F1 rotary filler, 6,000 bottles/h | `bottles` (per 10 s), `fill_rejects_pct` (rolling 5 min), `flow_var_pct`, `product_temp_c` |
| `c1-capper.csv` | C1 capper | `torque_nm`, `rejects_pct` (rolling 5 min), `vib_mm_s` |
| `k1-conveyor.csv` | K1 outfeed conveyor, 1.1 kW | `motor_temp_c`, `current_a`, `speed_pct` |

Every file also has `timestamp`, `state` (`run`/`stop`), `anomaly` (0/1) and `fault_type`.

## What makes it realistic

- **Production schedule**: two shifts 06:00–22:00, night shutdown, ~3 random micro-stops (3–8 min) per shift. When stopped, vibration and current are 0 and temperatures cool towards the hall temperature.
- **Hall temperature** follows a daily cycle (18–26 °C, peak 15:00) and drives bearing, motor and product temperatures.
- **Thermal inertia**: first-order lags (pump bearing 20 min, conveyor motor 15 min, product water 60 min), so temperatures rise and fall gradually, never faster than measured on real motors.
- **Coloured noise** (AR(1)) instead of white noise; levels from SKAB and the Electric Motor Temperature dataset.
- **Rejects are counts**: binomial draws on the real bottle count, reported over a 5-minute window like a line counter.
- **The line is coupled**: pump trouble reaches the filler after ~1 min and the capper after ~2 min.

## Labelled fault episodes

| Machine | `fault_type` | When (UTC) | Signature |
| --- | --- | --- | --- |
| C1 | `clutch_wear` | day 1, 10:00–13:00 | torque drifts +0.9 Nm (up to ~3.1 Nm), rejects rise once torque > 2.6 Nm |
| P1 | `cavitation` | day 1, 16:10–16:40 | flow −55 %, current −2 A, broadband vibration (SKAB `other/12`) |
| F1 | `valve_drift` | day 2, 07:30–08:30 | fill rejects rise to ~4–5 %, flow stable (local cause) |
| P1 | `bearing_wear` | day 2, 09:00–14:30 | vibration ×3.2 with impacts (up to ~4.8 mm/s), bearing 55 → 88 °C, +0.9 A |
| F1, C1 | `upstream_pump` | during P1 faults, delayed | flow variation up to 8 %, fill rejects up to ~5 % |
| K1 | `fan_clogged` | day 2, 17:00–18:30 | thermal resistance ×2.4: motor 51 → 88 °C at almost stable current |

`cooldown` marks samples after an episode while the machine is still above its warning level (anomaly = 0, the cause has been removed).
