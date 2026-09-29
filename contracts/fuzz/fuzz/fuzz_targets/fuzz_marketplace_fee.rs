#![no_main]

// libFuzzer target for the marketplace fee-calculation and tiered-fee harness.
//
// Asserts INV-FEE-1 through INV-FEE-7 on every input produced by the fuzzer:
//   INV-FEE-1: fee + net == amount          (no silent rounding loss)
//   INV-FEE-2: fee >= 0                     (fee never negative)
//   INV-FEE-3: net >= 0                     (net never negative)
//   INV-FEE-4: fee <= amount                (fee never exceeds amount)
//   INV-FEE-5: tier bps in [0, 10_000]     (tier fee within valid range)
//   INV-FEE-6: amount=0 never panics       (zero-amount boundary)
//   INV-FEE-7: MAX_AMOUNT boundary is safe  (no panic near i128::MAX / 2)
//
// Run with:
//   cargo fuzz run fuzz_marketplace_fee
//
// To replay a specific corpus entry:
//   cargo fuzz run fuzz_marketplace_fee corpus/marketplace_fee/fixtures.bin
libfuzzer_sys::fuzz_target!(|data: &[u8]| {
    kora_fuzz::targets::marketplace_fee::run(data);
});
