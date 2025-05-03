var Binary = (function() {
    let memory = new ArrayBuffer(8);
    let view_u8 = new Uint8Array(memory);
    let view_u32 = new Uint32Array(memory);
    let view_f64 = new Float64Array(memory);

    return {
        view_u8: view_u8,
        view_u32: view_u32,
        view_f64: view_f64,

        i64_to_f64: (i64) => {
            view_u32[0] = i64.low;
            view_u32[1] = i64.high;
            return view_f64[0];
        },
        f64_to_i64: (f) => {
            view_f64[0] = f;
            return new Int64(undefined, view_u32[0], view_u32[1]);
        },
        i32_to_u32: (i32) => {
            // needed because 0xffffffff -> -1 as an int
            view_u32[0] = i32;
            return view_u32[0];
        },
        is_32: (v) => {
            return (v >= -0x80000000 && v < 0x100000000)
        },
        i64_from_buffer: (buff) => {
            let conv_buff;
            if (buff.BYTES_PER_ELEMENT === 1)
                conv_buff = view_u8;
            else if (buff.BYTES_PER_ELEMENT === 4)
                conv_buff = view_u32;
            else if (buff.BYTES_PER_ELEMENT === 8)
                conv_buff = view_f64;
            // Copy bytes
            for (let i=0; i<8/buff.BYTES_PER_ELEMENT; i++) {
                conv_buff[i] = buff[i];
            }
            return new Int64(undefined, view_u32[0], view_u32[1]);
        },
        store_i64_in_buffer: (i64, buff, offset=0) => {
            view_u32[0] = i64.low;
            view_u32[1] = i64.high;

            if (buff.BYTES_PER_ELEMENT === 1)
                buff.set(view_u8, offset);
            else if (buff.BYTES_PER_ELEMENT === 4)
                buff.set(view_u32, offset);
            else if (buff.BYTES_PER_ELEMENT === 8)
                buff.set(view_f64, offset);
        }
    }
})();

class Int64 {
    constructor(v,low, high) {
        if (high !== undefined && low !== undefined) {
            this.high = high;
            this.low = low;
        } else if (v instanceof Int64) {
            this.high = v.high;
            this.low = v.low;
        } else {
            this._parse_arg(v);
        }
    }
    toString() {
        // Return as hex string
        return '0x'+Binary.i32_to_u32(this.high)
                .toString(16).padStart(8,'0') +
        Binary.i32_to_u32(this.low)
                .toString(16).padStart(8,'0');
    }
    _add_inplace(high, low) {
        let tmp = Binary.i32_to_u32(this.low) + Binary.i32_to_u32(low);
        this.low = tmp & 0xffffffff;
        let carry = (tmp > 0xffffffff)|0;
        this.high = (this.high + high + carry) & 0xffffffff;
        return this;
    }
    add_inplace(v) {
        if (v instanceof Int64)
            return this._add_inplace(v.high, v.low);

        return this.add_inplace(new Int64(v));
    }
    add(v) { return Int64.add(this, v); }

    eq(v) {
        if (v instanceof Int64)
            return this.high === v.high && this.low === v.low;
        return this.eq(new Int64(v));
    }

    lt(v) {
        if (v instanceof Int64) {
            if (this.high === v.high)
                return this.low < v.low;
            return this.high < v.high;
        }
        return this.lt(new Int64(v));
    }

    gt(v) {
        if (v instanceof Int64) {
            if (this.high === v.high)
                return this.low > v.low;
            return this.high > v.high;
        }
        return this.gt(new Int64(v));
    }

    _sub_inplace(high, low) {
        // Add with two's compliment
        this._add_inplace(~high, ~low)._add_inplace(0, 1);
        return this
    }
    sub_inplace(v) {
        if (v instanceof Int64)
            return this._sub_inplace(v.high, v.low);
        return this.sub_inplace(new Int64(v));
    }
    sub(v) { return Int64.sub(this, v); }

    to_double() { return Binary.i64_to_f64(this); }
    as_double() { return this.to_double(); }

    set_value(v) {
        if (v instanceof Int64) {
            this.high = v.high;
            this.low = v.low;
            return this;
        }
        this._parse_arg(v);
    }

    V8_from_SMI() { return Int64.V8_from_SMI(this); }
    V8_to_SMI() { return Int64.V8_to_SMI(this); }
    V8_untag() { return Int64.V8_untag(this); }
    V8_tag() { return Int64.V8_tag(this); }
    JSC_as_JSValue() { return Int64.JSC_as_JSValue(this); }

    high(v) {
        if (v !== undefined) {
            this.high = v;
        }
        return this.high;
    }
    low(v) {
        if (v !== undefined) {
            this.low = v;
        }
        return this.low;
    }

    // Try to decode the js type into this Int64
    // `v` can be a Int64, Number, BigInt, Array, Int8Array
    _parse_arg(v) {
        let low = null;
        let high = null;

        if (typeof(z) === 'bigint') {
            this.high(Number(z >> BigInt(32)));
            this.low(Number(z & BigInt(0xffffffff)));
            return this;
        }

        if (v instanceof Int64) {
            // Copy from existing Int64
            this.low(v.low);
            this.high(v.high);
            return this;
        }

        if (typeof(v) === 'number') {
            if ((v % 1) !== 0) {
                // Non integer, try to decode as double
                Binary.view_f64[0] = f;
                this.low(Binary.view_u32[0]);
                this.high(Binary.view_u32[1]);
                return this;
            }
            if (v < -0x80000000 || v > 0xffffffff) {
                // Try our best to convert to a 64-bit integer (may lose precision)
                this.low(v|0);
                this.high(Math.floor(v/0x100000000)|0);
                return this;
            }
            if (v < 0) {
                // Sign extend upper bits
                this.low(v|0);
                this.high(-1);
                return this;
            }
            // Zero extend upper bits
            this.low(v|0);
            this.high(0);
            return this;
        }

        if (typeof(v) === 'string') {
            // Try to parse int from string without losing precision
            v = v.toLowerCase();
            if (v.startsWith('0x')) {
                v = v.slice(2);
                if (v.length > 16)
                    throw("Hex string too long: "+v);

                this.low(parseInt(v.slice(-8), 16));
                if (v.length <= 8) {
                    this.high(0);
                } else {
                    this.high(parseInt(v.slice(0,-8), 16));
                }
                return this;
            } else {
                this._parse_arg(parseInt(v));
                return;
            }
        }

        if (v instanceof Int32Array || v instanceof Uint32Array
         || v instanceof Int8Array || v instanceof Uint8Array
         || v instanceof Array
        ) {
            if (v instanceof Int32Array || v instanceof Uint32Array) {
                Binary.view_u32.set(v);
            } else {
                Binary.view_u8.set(v);
            }
            this.low(Binary.view_u32[0]);
            this.high(Binary.view_u32[1]);
            return this;
        }

        throw ("Int64: Don't know how to convert to Int64: "+v);
    }

}

// If v is not an Int64, create one
Int64.to_Int64 = (v) => {
    if (v instanceof Int64)
        return v;
    return new Int64(v);
}
Int64.to_int = Int64.to_Int64;
Int64.to_int64 = Int64.to_Int64;
Int64.to = Int64.to_Int64;

Int64.from_double = (d) => {
    return Binary.f64_to_i64(d);
}

Int64.to_double = (v) => {
    v = Int64.to_Int64(v);
    return Binary.i64_to_f64(v);
}

Int64.as_double = (v) => {
    return Int64.to_double(v);
}

Int64.add = (a,b) => {
    let res = new Int64(a);
    return res.add_inplace(b)
}

Int64.sub = (a,b) => {
    let res = new Int64(a);
    return res.sub_inplace(b);
}

Int64.eq = (a,b) => {
    return a.high === b.high && a.low === b.low;
}

Int64.lt = (a,b) => {
    if (a.high === b.high)
        return a.low < b.low;
    return a.high < b.high;
}

Int64.gt = (a,b) => {
    if (a.high === b.high)
        return a.low > b.low;
    return a.high > b.high;
}


// Return an integer encoded as a V8 SMI
// 0x4142434 -> 0x4142434400000000
Int64.V8_to_SMI = (a) => {
    if (a.high !== 0)
        throw("Cannot make into SMI: " + a.toString());
    return new Int64(undefined, 0, a.low);
}

// Return an encoded V8 SMI as an integer
// 0x4142434400000000 -> 0x4142434
Int64.V8_from_SMI = (a) => {
    if (a.low !== 0)
        throw("Not encoded as an SMI: " + a.toString());
    return new Int64(undefined, a.high, 0);
}

Int64.V8_tag = (a) => {
    return new Int64(undefined, a.low|1, a.high);
}

Int64.V8_untag = (a) => {
    return new Int64(undefined, a.low&0xfffffffe, a.high);
}

// Return a NaNboxed JSValue
// This only makes sense for JavaScriptCore!
Int64.JSC_as_JSValue = (a) => {
    a = Int64.to_Int64(a);
    let high = Binary.i32_to_u32(a.high);
    if (high < 0x10000 || high >= 0xffff0000)
        throw(a.toString()+" cannot be encoded as JSValue");

    a._sub_inplace(0x10000, 0);
    let res = Binary.i64_to_f64(a);
    a._add_inplace(0x10000, 0);
    return res;
}
