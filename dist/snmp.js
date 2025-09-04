// @bun
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = import.meta.require;

// node_modules/asn1-ber/lib/ber/errors.js
var require_errors = __commonJS((exports, module) => {
  module.exports = {
    InvalidAsn1Error: function(msg) {
      var e = new Error;
      e.name = "InvalidAsn1Error";
      e.message = msg || "";
      return e;
    }
  };
});

// node_modules/asn1-ber/lib/ber/types.js
var require_types = __commonJS((exports, module) => {
  module.exports = {
    EOC: 0,
    Boolean: 1,
    Integer: 2,
    BitString: 3,
    OctetString: 4,
    Null: 5,
    OID: 6,
    ObjectDescriptor: 7,
    External: 8,
    Real: 9,
    Enumeration: 10,
    PDV: 11,
    Utf8String: 12,
    RelativeOID: 13,
    Sequence: 16,
    Set: 17,
    NumericString: 18,
    PrintableString: 19,
    T61String: 20,
    VideotexString: 21,
    IA5String: 22,
    UTCTime: 23,
    GeneralizedTime: 24,
    GraphicString: 25,
    VisibleString: 26,
    GeneralString: 28,
    UniversalString: 29,
    CharacterString: 30,
    BMPString: 31,
    Constructor: 32,
    Context: 128
  };
});

// node_modules/asn1-ber/lib/ber/reader.js
var require_reader = __commonJS((exports, module) => {
  var assert = __require("assert");
  var ASN1 = require_types();
  var errors = require_errors();
  var InvalidAsn1Error = errors.InvalidAsn1Error;
  function Reader(data) {
    if (!data || !Buffer.isBuffer(data))
      throw new TypeError("data must be a node Buffer");
    this._buf = data;
    this._size = data.length;
    this._len = 0;
    this._offset = 0;
  }
  Object.defineProperty(Reader.prototype, "length", {
    enumerable: true,
    get: function() {
      return this._len;
    }
  });
  Object.defineProperty(Reader.prototype, "offset", {
    enumerable: true,
    get: function() {
      return this._offset;
    }
  });
  Object.defineProperty(Reader.prototype, "remain", {
    get: function() {
      return this._size - this._offset;
    }
  });
  Object.defineProperty(Reader.prototype, "buffer", {
    get: function() {
      return this._buf.slice(this._offset);
    }
  });
  Reader.prototype.readByte = function(peek) {
    if (this._size - this._offset < 1)
      return null;
    var b = this._buf[this._offset] & 255;
    if (!peek)
      this._offset += 1;
    return b;
  };
  Reader.prototype.peek = function() {
    return this.readByte(true);
  };
  Reader.prototype.readLength = function(offset) {
    if (offset === undefined)
      offset = this._offset;
    if (offset >= this._size)
      return null;
    var lenB = this._buf[offset++] & 255;
    if (lenB === null)
      return null;
    if ((lenB & 128) == 128) {
      lenB &= 127;
      if (lenB == 0)
        throw InvalidAsn1Error("Indefinite length not supported");
      if (this._size - offset < lenB)
        return null;
      this._len = 0;
      for (var i = 0;i < lenB; i++) {
        this._len *= 256;
        this._len += this._buf[offset++] & 255;
      }
    } else {
      this._len = lenB;
    }
    return offset;
  };
  Reader.prototype.readSequence = function(tag) {
    var seq = this.peek();
    if (seq === null)
      return null;
    if (tag !== undefined && tag !== seq)
      throw InvalidAsn1Error("Expected 0x" + tag.toString(16) + ": got 0x" + seq.toString(16));
    var o = this.readLength(this._offset + 1);
    if (o === null)
      return null;
    this._offset = o;
    return seq;
  };
  Reader.prototype.readInt = function(tag) {
    return this._readTag(tag);
  };
  Reader.prototype.readBoolean = function(tag) {
    if (typeof tag !== "number")
      tag = ASN1.Boolean;
    return this._readTag(tag) === 0 ? false : true;
  };
  Reader.prototype.readEnumeration = function(tag) {
    if (typeof tag !== "number")
      tag = ASN1.Enumeration;
    return this._readTag(tag);
  };
  Reader.prototype.readString = function(tag, retbuf) {
    if (!tag)
      tag = ASN1.OctetString;
    var b = this.peek();
    if (b === null)
      return null;
    if (b !== tag)
      throw InvalidAsn1Error("Expected 0x" + tag.toString(16) + ": got 0x" + b.toString(16));
    var o = this.readLength(this._offset + 1);
    if (o === null)
      return null;
    if (this.length > this._size - o)
      return null;
    this._offset = o;
    if (this.length === 0)
      return retbuf ? Buffer.alloc(0) : "";
    var str = this._buf.slice(this._offset, this._offset + this.length);
    this._offset += this.length;
    return retbuf ? str : str.toString("utf8");
  };
  Reader.prototype.readOID = function(tag) {
    if (!tag)
      tag = ASN1.OID;
    var b = this.readString(tag, true);
    if (b === null)
      return null;
    var values = [];
    var value = 0;
    for (var i = 0;i < b.length; i++) {
      var byte = b[i] & 255;
      value <<= 7;
      value += byte & 127;
      if ((byte & 128) == 0) {
        values.push(value >>> 0);
        value = 0;
      }
    }
    value = values.shift();
    values.unshift(value % 40);
    values.unshift(value / 40 >> 0);
    return values.join(".");
  };
  Reader.prototype.readBitString = function(tag) {
    if (!tag)
      tag = ASN1.BitString;
    var b = this.peek();
    if (b === null)
      return null;
    if (b !== tag)
      throw InvalidAsn1Error("Expected 0x" + tag.toString(16) + ": got 0x" + b.toString(16));
    var o = this.readLength(this._offset + 1);
    if (o === null)
      return null;
    if (this.length > this._size - o)
      return null;
    this._offset = o;
    if (this.length === 0)
      return "";
    var ignoredBits = this._buf[this._offset++];
    var bitStringOctets = this._buf.slice(this._offset, this._offset + this.length - 1);
    var bitString = parseInt(bitStringOctets.toString("hex"), 16).toString(2).padStart(bitStringOctets.length * 8, "0");
    this._offset += this.length - 1;
    return bitString.substring(0, bitString.length - ignoredBits);
  };
  Reader.prototype._readTag = function(tag) {
    var b = this.peek();
    if (b === null)
      return null;
    if (tag !== undefined && b !== tag)
      throw InvalidAsn1Error("Expected 0x" + tag.toString(16) + ": got 0x" + b.toString(16));
    var o = this.readLength(this._offset + 1);
    if (o === null)
      return null;
    if (this.length === 0)
      throw InvalidAsn1Error("Zero-length integer");
    if (this.length > this._size - o)
      return null;
    this._offset = o;
    var value = this._buf.readInt8(this._offset++);
    for (var i = 1;i < this.length; i++) {
      value *= 256;
      value += this._buf[this._offset++];
    }
    if (!Number.isSafeInteger(value))
      throw InvalidAsn1Error("Integer not representable as javascript number");
    return value;
  };
  module.exports = Reader;
});

// node_modules/asn1-ber/lib/ber/writer.js
var require_writer = __commonJS((exports, module) => {
  var assert = __require("assert");
  var ASN1 = require_types();
  var errors = require_errors();
  var InvalidAsn1Error = errors.InvalidAsn1Error;
  var DEFAULT_OPTS = {
    size: 1024,
    growthFactor: 8
  };
  function merge(from, to) {
    assert.ok(from);
    assert.equal(typeof from, "object");
    assert.ok(to);
    assert.equal(typeof to, "object");
    var keys = Object.getOwnPropertyNames(from);
    keys.forEach(function(key) {
      if (to[key])
        return;
      var value = Object.getOwnPropertyDescriptor(from, key);
      Object.defineProperty(to, key, value);
    });
    return to;
  }
  function Writer(options) {
    options = merge(DEFAULT_OPTS, options || {});
    this._buf = Buffer.alloc(options.size || 1024);
    this._size = this._buf.length;
    this._offset = 0;
    this._options = options;
    this._seq = [];
  }
  Object.defineProperty(Writer.prototype, "buffer", {
    get: function() {
      if (this._seq.length)
        throw new InvalidAsn1Error(this._seq.length + " unended sequence(s)");
      return this._buf.slice(0, this._offset);
    }
  });
  Writer.prototype.writeByte = function(b) {
    if (typeof b !== "number")
      throw new TypeError("argument must be a Number");
    this._ensure(1);
    this._buf[this._offset++] = b;
  };
  Writer.prototype.writeInt = function(i, tag) {
    if (!Number.isInteger(i))
      throw new TypeError("argument must be an integer");
    if (typeof tag !== "number")
      tag = ASN1.Integer;
    let bytes = [];
    while (i < -128 || i >= 128) {
      bytes.push(i & 255);
      i = Math.floor(i / 256);
    }
    bytes.push(i & 255);
    this._ensure(2 + bytes.length);
    this._buf[this._offset++] = tag;
    this._buf[this._offset++] = bytes.length;
    while (bytes.length) {
      this._buf[this._offset++] = bytes.pop();
    }
  };
  Writer.prototype.writeNull = function() {
    this.writeByte(ASN1.Null);
    this.writeByte(0);
  };
  Writer.prototype.writeEnumeration = function(i, tag) {
    if (typeof i !== "number")
      throw new TypeError("argument must be a Number");
    if (typeof tag !== "number")
      tag = ASN1.Enumeration;
    return this.writeInt(i, tag);
  };
  Writer.prototype.writeBoolean = function(b, tag) {
    if (typeof b !== "boolean")
      throw new TypeError("argument must be a Boolean");
    if (typeof tag !== "number")
      tag = ASN1.Boolean;
    this._ensure(3);
    this._buf[this._offset++] = tag;
    this._buf[this._offset++] = 1;
    this._buf[this._offset++] = b ? 255 : 0;
  };
  Writer.prototype.writeString = function(s, tag) {
    if (typeof s !== "string")
      throw new TypeError("argument must be a string (was: " + typeof s + ")");
    if (typeof tag !== "number")
      tag = ASN1.OctetString;
    var len = Buffer.byteLength(s);
    this.writeByte(tag);
    this.writeLength(len);
    if (len) {
      this._ensure(len);
      this._buf.write(s, this._offset);
      this._offset += len;
    }
  };
  Writer.prototype.writeBuffer = function(buf, tag) {
    if (!Buffer.isBuffer(buf))
      throw new TypeError("argument must be a buffer");
    if (typeof tag === "number") {
      this.writeByte(tag);
      this.writeLength(buf.length);
    }
    if (buf.length > 0) {
      this._ensure(buf.length);
      buf.copy(this._buf, this._offset, 0, buf.length);
      this._offset += buf.length;
    }
  };
  Writer.prototype.writeStringArray = function(strings, tag) {
    if (!(strings instanceof Array))
      throw new TypeError("argument must be an Array[String]");
    var self = this;
    strings.forEach(function(s) {
      self.writeString(s, tag);
    });
  };
  Writer.prototype.writeOID = function(s, tag) {
    if (typeof s !== "string")
      throw new TypeError("argument must be a string");
    if (typeof tag !== "number")
      tag = ASN1.OID;
    if (!/^([0-9]+\.){0,}[0-9]+$/.test(s))
      throw new Error("argument is not a valid OID string");
    function encodeOctet(bytes2, octet) {
      if (octet < 128) {
        bytes2.push(octet);
      } else if (octet < 16384) {
        bytes2.push(octet >>> 7 | 128);
        bytes2.push(octet & 127);
      } else if (octet < 2097152) {
        bytes2.push(octet >>> 14 | 128);
        bytes2.push((octet >>> 7 | 128) & 255);
        bytes2.push(octet & 127);
      } else if (octet < 268435456) {
        bytes2.push(octet >>> 21 | 128);
        bytes2.push((octet >>> 14 | 128) & 255);
        bytes2.push((octet >>> 7 | 128) & 255);
        bytes2.push(octet & 127);
      } else {
        bytes2.push((octet >>> 28 | 128) & 255);
        bytes2.push((octet >>> 21 | 128) & 255);
        bytes2.push((octet >>> 14 | 128) & 255);
        bytes2.push((octet >>> 7 | 128) & 255);
        bytes2.push(octet & 127);
      }
    }
    var tmp = s.split(".");
    var bytes = [];
    bytes.push(parseInt(tmp[0], 10) * 40 + parseInt(tmp[1], 10));
    tmp.slice(2).forEach(function(b) {
      encodeOctet(bytes, parseInt(b, 10));
    });
    var self = this;
    this._ensure(2 + bytes.length);
    this.writeByte(tag);
    this.writeLength(bytes.length);
    bytes.forEach(function(b) {
      self.writeByte(b);
    });
  };
  Writer.prototype.writeLength = function(len) {
    if (typeof len !== "number")
      throw new TypeError("argument must be a Number");
    this._ensure(4);
    if (len <= 127) {
      this._buf[this._offset++] = len;
    } else if (len <= 255) {
      this._buf[this._offset++] = 129;
      this._buf[this._offset++] = len;
    } else if (len <= 65535) {
      this._buf[this._offset++] = 130;
      this._buf[this._offset++] = len >> 8;
      this._buf[this._offset++] = len;
    } else if (len <= 16777215) {
      this._buf[this._offset++] = 131;
      this._buf[this._offset++] = len >> 16;
      this._buf[this._offset++] = len >> 8;
      this._buf[this._offset++] = len;
    } else {
      throw new InvalidAsn1Error("Length too long (> 4 bytes)");
    }
  };
  Writer.prototype.startSequence = function(tag) {
    if (typeof tag !== "number")
      tag = ASN1.Sequence | ASN1.Constructor;
    this.writeByte(tag);
    this._seq.push(this._offset);
    this._ensure(3);
    this._offset += 3;
  };
  Writer.prototype.endSequence = function() {
    var seq = this._seq.pop();
    var start = seq + 3;
    var len = this._offset - start;
    if (len <= 127) {
      this._shift(start, len, -2);
      this._buf[seq] = len;
    } else if (len <= 255) {
      this._shift(start, len, -1);
      this._buf[seq] = 129;
      this._buf[seq + 1] = len;
    } else if (len <= 65535) {
      this._buf[seq] = 130;
      this._buf[seq + 1] = len >> 8;
      this._buf[seq + 2] = len;
    } else if (len <= 16777215) {
      this._shift(start, len, 1);
      this._buf[seq] = 131;
      this._buf[seq + 1] = len >> 16;
      this._buf[seq + 2] = len >> 8;
      this._buf[seq + 3] = len;
    } else {
      throw new InvalidAsn1Error("Sequence too long");
    }
  };
  Writer.prototype._shift = function(start, len, shift) {
    assert.ok(start !== undefined);
    assert.ok(len !== undefined);
    assert.ok(shift);
    this._buf.copy(this._buf, start + shift, start, start + len);
    this._offset += shift;
  };
  Writer.prototype._ensure = function(len) {
    assert.ok(len);
    if (this._size - this._offset < len) {
      var sz = this._size * this._options.growthFactor;
      if (sz - this._offset < len)
        sz += len;
      var buf = Buffer.alloc(sz);
      this._buf.copy(buf, 0, 0, this._offset);
      this._buf = buf;
      this._size = sz;
    }
  };
  module.exports = Writer;
});

// node_modules/asn1-ber/lib/ber/index.js
var require_ber = __commonJS((exports) => {
  var errors = require_errors();
  var types = require_types();
  var Reader = require_reader();
  var Writer = require_writer();
  for (t in types)
    if (types.hasOwnProperty(t))
      exports[t] = types[t];
  var t;
  for (e in errors)
    if (errors.hasOwnProperty(e))
      exports[e] = errors[e];
  var e;
  exports.Reader = Reader;
  exports.Writer = Writer;
});

// node_modules/asn1-ber/index.js
var require_asn1_ber = __commonJS((exports) => {
  var Ber = require_ber();
  exports.Ber = Ber;
  exports.BerReader = Ber.Reader;
  exports.BerWriter = Ber.Writer;
});

// node_modules/smart-buffer/build/utils.js
var require_utils = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var buffer_1 = __require("buffer");
  var ERRORS = {
    INVALID_ENCODING: "Invalid encoding provided. Please specify a valid encoding the internal Node.js Buffer supports.",
    INVALID_SMARTBUFFER_SIZE: "Invalid size provided. Size must be a valid integer greater than zero.",
    INVALID_SMARTBUFFER_BUFFER: "Invalid Buffer provided in SmartBufferOptions.",
    INVALID_SMARTBUFFER_OBJECT: "Invalid SmartBufferOptions object supplied to SmartBuffer constructor or factory methods.",
    INVALID_OFFSET: "An invalid offset value was provided.",
    INVALID_OFFSET_NON_NUMBER: "An invalid offset value was provided. A numeric value is required.",
    INVALID_LENGTH: "An invalid length value was provided.",
    INVALID_LENGTH_NON_NUMBER: "An invalid length value was provived. A numeric value is required.",
    INVALID_TARGET_OFFSET: "Target offset is beyond the bounds of the internal SmartBuffer data.",
    INVALID_TARGET_LENGTH: "Specified length value moves cursor beyong the bounds of the internal SmartBuffer data.",
    INVALID_READ_BEYOND_BOUNDS: "Attempted to read beyond the bounds of the managed data.",
    INVALID_WRITE_BEYOND_BOUNDS: "Attempted to write beyond the bounds of the managed data."
  };
  exports.ERRORS = ERRORS;
  function checkEncoding(encoding) {
    if (!buffer_1.Buffer.isEncoding(encoding)) {
      throw new Error(ERRORS.INVALID_ENCODING);
    }
  }
  exports.checkEncoding = checkEncoding;
  function isFiniteInteger(value) {
    return typeof value === "number" && isFinite(value) && isInteger(value);
  }
  exports.isFiniteInteger = isFiniteInteger;
  function checkOffsetOrLengthValue(value, offset) {
    if (typeof value === "number") {
      if (!isFiniteInteger(value) || value < 0) {
        throw new Error(offset ? ERRORS.INVALID_OFFSET : ERRORS.INVALID_LENGTH);
      }
    } else {
      throw new Error(offset ? ERRORS.INVALID_OFFSET_NON_NUMBER : ERRORS.INVALID_LENGTH_NON_NUMBER);
    }
  }
  function checkLengthValue(length) {
    checkOffsetOrLengthValue(length, false);
  }
  exports.checkLengthValue = checkLengthValue;
  function checkOffsetValue(offset) {
    checkOffsetOrLengthValue(offset, true);
  }
  exports.checkOffsetValue = checkOffsetValue;
  function checkTargetOffset(offset, buff) {
    if (offset < 0 || offset > buff.length) {
      throw new Error(ERRORS.INVALID_TARGET_OFFSET);
    }
  }
  exports.checkTargetOffset = checkTargetOffset;
  function isInteger(value) {
    return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
  }
  function bigIntAndBufferInt64Check(bufferMethod) {
    if (typeof BigInt === "undefined") {
      throw new Error("Platform does not support JS BigInt type.");
    }
    if (typeof buffer_1.Buffer.prototype[bufferMethod] === "undefined") {
      throw new Error(`Platform does not support Buffer.prototype.${bufferMethod}.`);
    }
  }
  exports.bigIntAndBufferInt64Check = bigIntAndBufferInt64Check;
});

// node_modules/smart-buffer/build/smartbuffer.js
var require_smartbuffer = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  var utils_1 = require_utils();
  var DEFAULT_SMARTBUFFER_SIZE = 4096;
  var DEFAULT_SMARTBUFFER_ENCODING = "utf8";

  class SmartBuffer {
    constructor(options) {
      this.length = 0;
      this._encoding = DEFAULT_SMARTBUFFER_ENCODING;
      this._writeOffset = 0;
      this._readOffset = 0;
      if (SmartBuffer.isSmartBufferOptions(options)) {
        if (options.encoding) {
          utils_1.checkEncoding(options.encoding);
          this._encoding = options.encoding;
        }
        if (options.size) {
          if (utils_1.isFiniteInteger(options.size) && options.size > 0) {
            this._buff = Buffer.allocUnsafe(options.size);
          } else {
            throw new Error(utils_1.ERRORS.INVALID_SMARTBUFFER_SIZE);
          }
        } else if (options.buff) {
          if (Buffer.isBuffer(options.buff)) {
            this._buff = options.buff;
            this.length = options.buff.length;
          } else {
            throw new Error(utils_1.ERRORS.INVALID_SMARTBUFFER_BUFFER);
          }
        } else {
          this._buff = Buffer.allocUnsafe(DEFAULT_SMARTBUFFER_SIZE);
        }
      } else {
        if (typeof options !== "undefined") {
          throw new Error(utils_1.ERRORS.INVALID_SMARTBUFFER_OBJECT);
        }
        this._buff = Buffer.allocUnsafe(DEFAULT_SMARTBUFFER_SIZE);
      }
    }
    static fromSize(size, encoding) {
      return new this({
        size,
        encoding
      });
    }
    static fromBuffer(buff, encoding) {
      return new this({
        buff,
        encoding
      });
    }
    static fromOptions(options) {
      return new this(options);
    }
    static isSmartBufferOptions(options) {
      const castOptions = options;
      return castOptions && (castOptions.encoding !== undefined || castOptions.size !== undefined || castOptions.buff !== undefined);
    }
    readInt8(offset) {
      return this._readNumberValue(Buffer.prototype.readInt8, 1, offset);
    }
    readInt16BE(offset) {
      return this._readNumberValue(Buffer.prototype.readInt16BE, 2, offset);
    }
    readInt16LE(offset) {
      return this._readNumberValue(Buffer.prototype.readInt16LE, 2, offset);
    }
    readInt32BE(offset) {
      return this._readNumberValue(Buffer.prototype.readInt32BE, 4, offset);
    }
    readInt32LE(offset) {
      return this._readNumberValue(Buffer.prototype.readInt32LE, 4, offset);
    }
    readBigInt64BE(offset) {
      utils_1.bigIntAndBufferInt64Check("readBigInt64BE");
      return this._readNumberValue(Buffer.prototype.readBigInt64BE, 8, offset);
    }
    readBigInt64LE(offset) {
      utils_1.bigIntAndBufferInt64Check("readBigInt64LE");
      return this._readNumberValue(Buffer.prototype.readBigInt64LE, 8, offset);
    }
    writeInt8(value, offset) {
      this._writeNumberValue(Buffer.prototype.writeInt8, 1, value, offset);
      return this;
    }
    insertInt8(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeInt8, 1, value, offset);
    }
    writeInt16BE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeInt16BE, 2, value, offset);
    }
    insertInt16BE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeInt16BE, 2, value, offset);
    }
    writeInt16LE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeInt16LE, 2, value, offset);
    }
    insertInt16LE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeInt16LE, 2, value, offset);
    }
    writeInt32BE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeInt32BE, 4, value, offset);
    }
    insertInt32BE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeInt32BE, 4, value, offset);
    }
    writeInt32LE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeInt32LE, 4, value, offset);
    }
    insertInt32LE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeInt32LE, 4, value, offset);
    }
    writeBigInt64BE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigInt64BE");
      return this._writeNumberValue(Buffer.prototype.writeBigInt64BE, 8, value, offset);
    }
    insertBigInt64BE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigInt64BE");
      return this._insertNumberValue(Buffer.prototype.writeBigInt64BE, 8, value, offset);
    }
    writeBigInt64LE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigInt64LE");
      return this._writeNumberValue(Buffer.prototype.writeBigInt64LE, 8, value, offset);
    }
    insertBigInt64LE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigInt64LE");
      return this._insertNumberValue(Buffer.prototype.writeBigInt64LE, 8, value, offset);
    }
    readUInt8(offset) {
      return this._readNumberValue(Buffer.prototype.readUInt8, 1, offset);
    }
    readUInt16BE(offset) {
      return this._readNumberValue(Buffer.prototype.readUInt16BE, 2, offset);
    }
    readUInt16LE(offset) {
      return this._readNumberValue(Buffer.prototype.readUInt16LE, 2, offset);
    }
    readUInt32BE(offset) {
      return this._readNumberValue(Buffer.prototype.readUInt32BE, 4, offset);
    }
    readUInt32LE(offset) {
      return this._readNumberValue(Buffer.prototype.readUInt32LE, 4, offset);
    }
    readBigUInt64BE(offset) {
      utils_1.bigIntAndBufferInt64Check("readBigUInt64BE");
      return this._readNumberValue(Buffer.prototype.readBigUInt64BE, 8, offset);
    }
    readBigUInt64LE(offset) {
      utils_1.bigIntAndBufferInt64Check("readBigUInt64LE");
      return this._readNumberValue(Buffer.prototype.readBigUInt64LE, 8, offset);
    }
    writeUInt8(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeUInt8, 1, value, offset);
    }
    insertUInt8(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeUInt8, 1, value, offset);
    }
    writeUInt16BE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeUInt16BE, 2, value, offset);
    }
    insertUInt16BE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeUInt16BE, 2, value, offset);
    }
    writeUInt16LE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeUInt16LE, 2, value, offset);
    }
    insertUInt16LE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeUInt16LE, 2, value, offset);
    }
    writeUInt32BE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeUInt32BE, 4, value, offset);
    }
    insertUInt32BE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeUInt32BE, 4, value, offset);
    }
    writeUInt32LE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeUInt32LE, 4, value, offset);
    }
    insertUInt32LE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeUInt32LE, 4, value, offset);
    }
    writeBigUInt64BE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigUInt64BE");
      return this._writeNumberValue(Buffer.prototype.writeBigUInt64BE, 8, value, offset);
    }
    insertBigUInt64BE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigUInt64BE");
      return this._insertNumberValue(Buffer.prototype.writeBigUInt64BE, 8, value, offset);
    }
    writeBigUInt64LE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigUInt64LE");
      return this._writeNumberValue(Buffer.prototype.writeBigUInt64LE, 8, value, offset);
    }
    insertBigUInt64LE(value, offset) {
      utils_1.bigIntAndBufferInt64Check("writeBigUInt64LE");
      return this._insertNumberValue(Buffer.prototype.writeBigUInt64LE, 8, value, offset);
    }
    readFloatBE(offset) {
      return this._readNumberValue(Buffer.prototype.readFloatBE, 4, offset);
    }
    readFloatLE(offset) {
      return this._readNumberValue(Buffer.prototype.readFloatLE, 4, offset);
    }
    writeFloatBE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeFloatBE, 4, value, offset);
    }
    insertFloatBE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeFloatBE, 4, value, offset);
    }
    writeFloatLE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeFloatLE, 4, value, offset);
    }
    insertFloatLE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeFloatLE, 4, value, offset);
    }
    readDoubleBE(offset) {
      return this._readNumberValue(Buffer.prototype.readDoubleBE, 8, offset);
    }
    readDoubleLE(offset) {
      return this._readNumberValue(Buffer.prototype.readDoubleLE, 8, offset);
    }
    writeDoubleBE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeDoubleBE, 8, value, offset);
    }
    insertDoubleBE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeDoubleBE, 8, value, offset);
    }
    writeDoubleLE(value, offset) {
      return this._writeNumberValue(Buffer.prototype.writeDoubleLE, 8, value, offset);
    }
    insertDoubleLE(value, offset) {
      return this._insertNumberValue(Buffer.prototype.writeDoubleLE, 8, value, offset);
    }
    readString(arg1, encoding) {
      let lengthVal;
      if (typeof arg1 === "number") {
        utils_1.checkLengthValue(arg1);
        lengthVal = Math.min(arg1, this.length - this._readOffset);
      } else {
        encoding = arg1;
        lengthVal = this.length - this._readOffset;
      }
      if (typeof encoding !== "undefined") {
        utils_1.checkEncoding(encoding);
      }
      const value = this._buff.slice(this._readOffset, this._readOffset + lengthVal).toString(encoding || this._encoding);
      this._readOffset += lengthVal;
      return value;
    }
    insertString(value, offset, encoding) {
      utils_1.checkOffsetValue(offset);
      return this._handleString(value, true, offset, encoding);
    }
    writeString(value, arg2, encoding) {
      return this._handleString(value, false, arg2, encoding);
    }
    readStringNT(encoding) {
      if (typeof encoding !== "undefined") {
        utils_1.checkEncoding(encoding);
      }
      let nullPos = this.length;
      for (let i = this._readOffset;i < this.length; i++) {
        if (this._buff[i] === 0) {
          nullPos = i;
          break;
        }
      }
      const value = this._buff.slice(this._readOffset, nullPos);
      this._readOffset = nullPos + 1;
      return value.toString(encoding || this._encoding);
    }
    insertStringNT(value, offset, encoding) {
      utils_1.checkOffsetValue(offset);
      this.insertString(value, offset, encoding);
      this.insertUInt8(0, offset + value.length);
      return this;
    }
    writeStringNT(value, arg2, encoding) {
      this.writeString(value, arg2, encoding);
      this.writeUInt8(0, typeof arg2 === "number" ? arg2 + value.length : this.writeOffset);
      return this;
    }
    readBuffer(length) {
      if (typeof length !== "undefined") {
        utils_1.checkLengthValue(length);
      }
      const lengthVal = typeof length === "number" ? length : this.length;
      const endPoint = Math.min(this.length, this._readOffset + lengthVal);
      const value = this._buff.slice(this._readOffset, endPoint);
      this._readOffset = endPoint;
      return value;
    }
    insertBuffer(value, offset) {
      utils_1.checkOffsetValue(offset);
      return this._handleBuffer(value, true, offset);
    }
    writeBuffer(value, offset) {
      return this._handleBuffer(value, false, offset);
    }
    readBufferNT() {
      let nullPos = this.length;
      for (let i = this._readOffset;i < this.length; i++) {
        if (this._buff[i] === 0) {
          nullPos = i;
          break;
        }
      }
      const value = this._buff.slice(this._readOffset, nullPos);
      this._readOffset = nullPos + 1;
      return value;
    }
    insertBufferNT(value, offset) {
      utils_1.checkOffsetValue(offset);
      this.insertBuffer(value, offset);
      this.insertUInt8(0, offset + value.length);
      return this;
    }
    writeBufferNT(value, offset) {
      if (typeof offset !== "undefined") {
        utils_1.checkOffsetValue(offset);
      }
      this.writeBuffer(value, offset);
      this.writeUInt8(0, typeof offset === "number" ? offset + value.length : this._writeOffset);
      return this;
    }
    clear() {
      this._writeOffset = 0;
      this._readOffset = 0;
      this.length = 0;
      return this;
    }
    remaining() {
      return this.length - this._readOffset;
    }
    get readOffset() {
      return this._readOffset;
    }
    set readOffset(offset) {
      utils_1.checkOffsetValue(offset);
      utils_1.checkTargetOffset(offset, this);
      this._readOffset = offset;
    }
    get writeOffset() {
      return this._writeOffset;
    }
    set writeOffset(offset) {
      utils_1.checkOffsetValue(offset);
      utils_1.checkTargetOffset(offset, this);
      this._writeOffset = offset;
    }
    get encoding() {
      return this._encoding;
    }
    set encoding(encoding) {
      utils_1.checkEncoding(encoding);
      this._encoding = encoding;
    }
    get internalBuffer() {
      return this._buff;
    }
    toBuffer() {
      return this._buff.slice(0, this.length);
    }
    toString(encoding) {
      const encodingVal = typeof encoding === "string" ? encoding : this._encoding;
      utils_1.checkEncoding(encodingVal);
      return this._buff.toString(encodingVal, 0, this.length);
    }
    destroy() {
      this.clear();
      return this;
    }
    _handleString(value, isInsert, arg3, encoding) {
      let offsetVal = this._writeOffset;
      let encodingVal = this._encoding;
      if (typeof arg3 === "number") {
        offsetVal = arg3;
      } else if (typeof arg3 === "string") {
        utils_1.checkEncoding(arg3);
        encodingVal = arg3;
      }
      if (typeof encoding === "string") {
        utils_1.checkEncoding(encoding);
        encodingVal = encoding;
      }
      const byteLength = Buffer.byteLength(value, encodingVal);
      if (isInsert) {
        this.ensureInsertable(byteLength, offsetVal);
      } else {
        this._ensureWriteable(byteLength, offsetVal);
      }
      this._buff.write(value, offsetVal, byteLength, encodingVal);
      if (isInsert) {
        this._writeOffset += byteLength;
      } else {
        if (typeof arg3 === "number") {
          this._writeOffset = Math.max(this._writeOffset, offsetVal + byteLength);
        } else {
          this._writeOffset += byteLength;
        }
      }
      return this;
    }
    _handleBuffer(value, isInsert, offset) {
      const offsetVal = typeof offset === "number" ? offset : this._writeOffset;
      if (isInsert) {
        this.ensureInsertable(value.length, offsetVal);
      } else {
        this._ensureWriteable(value.length, offsetVal);
      }
      value.copy(this._buff, offsetVal);
      if (isInsert) {
        this._writeOffset += value.length;
      } else {
        if (typeof offset === "number") {
          this._writeOffset = Math.max(this._writeOffset, offsetVal + value.length);
        } else {
          this._writeOffset += value.length;
        }
      }
      return this;
    }
    ensureReadable(length, offset) {
      let offsetVal = this._readOffset;
      if (typeof offset !== "undefined") {
        utils_1.checkOffsetValue(offset);
        offsetVal = offset;
      }
      if (offsetVal < 0 || offsetVal + length > this.length) {
        throw new Error(utils_1.ERRORS.INVALID_READ_BEYOND_BOUNDS);
      }
    }
    ensureInsertable(dataLength, offset) {
      utils_1.checkOffsetValue(offset);
      this._ensureCapacity(this.length + dataLength);
      if (offset < this.length) {
        this._buff.copy(this._buff, offset + dataLength, offset, this._buff.length);
      }
      if (offset + dataLength > this.length) {
        this.length = offset + dataLength;
      } else {
        this.length += dataLength;
      }
    }
    _ensureWriteable(dataLength, offset) {
      const offsetVal = typeof offset === "number" ? offset : this._writeOffset;
      this._ensureCapacity(offsetVal + dataLength);
      if (offsetVal + dataLength > this.length) {
        this.length = offsetVal + dataLength;
      }
    }
    _ensureCapacity(minLength) {
      const oldLength = this._buff.length;
      if (minLength > oldLength) {
        let data = this._buff;
        let newLength = oldLength * 3 / 2 + 1;
        if (newLength < minLength) {
          newLength = minLength;
        }
        this._buff = Buffer.allocUnsafe(newLength);
        data.copy(this._buff, 0, 0, oldLength);
      }
    }
    _readNumberValue(func, byteSize, offset) {
      this.ensureReadable(byteSize, offset);
      const value = func.call(this._buff, typeof offset === "number" ? offset : this._readOffset);
      if (typeof offset === "undefined") {
        this._readOffset += byteSize;
      }
      return value;
    }
    _insertNumberValue(func, byteSize, value, offset) {
      utils_1.checkOffsetValue(offset);
      this.ensureInsertable(byteSize, offset);
      func.call(this._buff, value, offset);
      this._writeOffset += byteSize;
      return this;
    }
    _writeNumberValue(func, byteSize, value, offset) {
      if (typeof offset === "number") {
        if (offset < 0) {
          throw new Error(utils_1.ERRORS.INVALID_WRITE_BEYOND_BOUNDS);
        }
        utils_1.checkOffsetValue(offset);
      }
      const offsetVal = typeof offset === "number" ? offset : this._writeOffset;
      this._ensureWriteable(byteSize, offsetVal);
      func.call(this._buff, value, offsetVal);
      if (typeof offset === "number") {
        this._writeOffset = Math.max(this._writeOffset, offsetVal + byteSize);
      } else {
        this._writeOffset += byteSize;
      }
      return this;
    }
  }
  exports.SmartBuffer = SmartBuffer;
});

// node_modules/net-snmp/lib/mib.js
var require_mib = __commonJS((exports, module) => {
  var fs = __require("fs");
  var path = __require("path");
  var MIB = function(dir) {
    var initializeBuffer = function(buffer) {
      return Object.assign(buffer, {
        logit: false,
        lastChar: "",
        state: "",
        open: false,
        CurrentSymbol: "",
        nested: 0,
        isComment: false,
        isEqual: false,
        isOID: false,
        isList: false,
        isString: false,
        inComment: false,
        inGroup: 0,
        builder: "",
        ColumnIndex: 0,
        RowIndex: 0,
        PreviousRow: 0
      });
    };
    var newMIB = {
      directory: dir ? dir : "",
      SymbolBuffer: {},
      StringBuffer: "",
      Modules: {},
      Objects: {},
      MACROS: [],
      CurrentObject: null,
      TempObject: {},
      CurrentClause: "",
      WaitFor: "",
      CharBuffer: {
        Table: {},
        ModuleName: {},
        Append: function(char) {
          this.builder += char;
        },
        Fill: function(FileName, row, column) {
          if (this.builder.length == 0) {
            return;
          }
          column = column - this.builder.length;
          var symbol = this.builder.toString().trim();
          this.builder = "";
          if (!this.Table[FileName]) {
            this.Table[FileName] = [];
          } else if (this.PreviousRow < row) {
            this.RowIndex++;
            this.ColumnIndex = 0;
            this.PreviousRow = row;
          }
          var R = this.RowIndex;
          var C = this.ColumnIndex;
          if (!this.Table[FileName][R] || C === 0) {
            this.Table[FileName][R] = Object.defineProperty([], "line", {
              enumerable: false,
              value: row + 1
            });
          }
          this.isEqual = false;
          switch (symbol) {
            case ")":
              this.Table[FileName][R][C] = symbol;
              this.ColumnIndex++;
              this.logit = false;
              break;
            case "(":
              this.Table[FileName][R][C] = symbol;
              this.ColumnIndex++;
              this.logit = true;
              break;
            case "DEFINITIONS":
              if (C == 0) {
                this.ModuleName[FileName] = this.Table[FileName][R - 1][C];
              } else {
                this.ModuleName[FileName] = this.Table[FileName][R][C - 1];
              }
              this.Table[FileName][R][C] = symbol;
              this.ColumnIndex++;
              break;
            case "::=":
              this.Table[FileName][R][C] = symbol;
              this.ColumnIndex++;
              this.isEqual = true;
              break;
            case "{":
              if (this.Table[FileName][R][C - 1] != "::=") {
                this.isList = true;
              }
              this.Table[FileName][R][C] = symbol;
              this.ColumnIndex++;
              break;
            case "NOTATION":
              if (this.Table[FileName][R][C - 1] == "TYPE" || this.Table[FileName][R][C - 1] == "VALUE") {
                this.Table[FileName][R][C - 1] += " NOTATION";
              }
              break;
            case "OF":
              if (this.Table[FileName][R][C - 1] == "SEQUENCE") {
                this.Table[FileName][R][C - 1] = "SEQUENCE OF";
              }
              break;
            case "IDENTIFIER":
              if (this.Table[FileName][R][C - 1] == "OBJECT") {
                this.Table[FileName][R][C - 1] = "OBJECT IDENTIFIER";
              }
              break;
            case "STRING":
              if (this.Table[FileName][R][C - 1] == "OCTET") {
                this.Table[FileName][R][C - 1] = "OCTET STRING";
              }
              break;
            default:
              this.Table[FileName][R][C] = symbol;
              this.ColumnIndex++;
              break;
          }
        }
      },
      Import: function(FileName) {
        this.ParseModule(path.basename(FileName, path.extname(FileName)), fs.readFileSync(FileName).toString());
      },
      ParseModule: function(FileName, Contents) {
        initializeBuffer(this.CharBuffer);
        var lines = Contents.split(`
`);
        var line = "";
        var i = 0;
        while ((line = lines[i]) != null && i <= lines.length) {
          this.ParseLine(FileName, line, i);
          i++;
        }
      },
      ParseLine: function(FileName, line, row) {
        let len = line.length;
        if (line[len - 1] === "\r")
          --len;
        for (var i = 0;i < len; i++) {
          var char = line.charAt(i);
          this.ParseChar(FileName, char, row, i);
        }
        this.ParseChar(FileName, `
`, row, len);
      },
      ParseChar: function(FileName, char, row, column) {
        switch (char) {
          case "\r":
          case `
`:
            if (!this.CharBuffer.isString) {
              this.CharBuffer.Fill(FileName, row, column);
              this.CharBuffer.isComment = false;
              this.CharBuffer.inGroup = 0;
            } else if (this.CharBuffer.isString && this.CharBuffer.isComment) {
              this.CharBuffer.Append(char);
            }
            break;
          case "{":
            if (!this.CharBuffer.isComment && this.CharBuffer.isEqual) {
              this.CharBuffer.isOID = true;
            }
          case "[":
          case "(":
            if (!this.CharBuffer.isComment && !this.CharBuffer.isString) {
              this.CharBuffer.nested++;
              if (char == "(" || char == "{") {
                if (this.CharBuffer.nested === 1) {
                  this.CharBuffer.Fill(FileName, row, column);
                }
                this.CharBuffer.inGroup++;
              }
            }
            if (this.CharBuffer.isComment || (this.CharBuffer.isOID || this.CharBuffer.nested > 0) && (!this.CharBuffer.isList || this.CharBuffer.inGroup > 0)) {
              this.CharBuffer.Append(char);
            } else {
              this.CharBuffer.Fill(FileName, row, column);
              this.CharBuffer.Append(char);
              this.CharBuffer.Fill(FileName, row, column);
            }
            break;
          case "}":
          case "]":
          case ")":
            if (!this.CharBuffer.isComment && !this.CharBuffer.isString) {
              this.CharBuffer.nested--;
              if (this.CharBuffer.nested < 0) {
                this.CharBuffer.nested = 0;
              }
              if (char == ")") {
                this.CharBuffer.inGroup--;
                if (this.CharBuffer.inGroup < 0) {
                  this.CharBuffer.inGroup = 0;
                }
              }
            }
            if (this.CharBuffer.isComment || (this.CharBuffer.isOID || this.CharBuffer.nested >= 0) && (!this.CharBuffer.isList || this.CharBuffer.inGroup >= 0)) {
              this.CharBuffer.Append(char);
            } else {
              this.CharBuffer.Fill(FileName, row, column);
              this.CharBuffer.Append(char);
              this.CharBuffer.Fill(FileName, row, column);
            }
            if (char == "}") {
              this.CharBuffer.isOID = false;
              this.CharBuffer.isList = false;
            }
            break;
          case ",":
            if (this.CharBuffer.isComment) {
              this.CharBuffer.Append(char);
            } else {
              this.CharBuffer.Fill(FileName, row, column);
              this.CharBuffer.Append(char);
              this.CharBuffer.Fill(FileName, row, column);
            }
            break;
          case ";":
            if (this.CharBuffer.isComment) {
              this.CharBuffer.Append(char);
            } else {
              this.CharBuffer.Fill(FileName, row, column);
              this.CharBuffer.Append(char);
              this.CharBuffer.Fill(FileName, row, column);
            }
            break;
          case " ":
          case "\t":
            if (this.CharBuffer.isComment || (this.CharBuffer.isOID || this.CharBuffer.nested > 0) && (!this.CharBuffer.isList || this.CharBuffer.inGroup > 0)) {
              this.CharBuffer.Append(char);
            } else {
              this.CharBuffer.Fill(FileName, row, column);
            }
            break;
          case "-":
            this.CharBuffer.Append(char);
            if (!this.CharBuffer.isString && this.CharBuffer.lastChar == "-") {
              this.CharBuffer.isComment = true;
              this.CharBuffer.builder = this.CharBuffer.builder.split("--")[0];
              this.CharBuffer.Fill(FileName, row, column);
              this.CharBuffer.builder = "--";
            }
            break;
          case '"':
            if (this.CharBuffer.isComment && !this.CharBuffer.isString && !this.CharBuffer.inComment) {
              this.CharBuffer.isComment = true;
              this.CharBuffer.isString = false;
              this.CharBuffer.inComment = true;
            } else if (!this.CharBuffer.isComment && !this.CharBuffer.isString && !this.CharBuffer.inComment) {
              this.CharBuffer.isComment = true;
              this.CharBuffer.isString = true;
              this.CharBuffer.inComment = false;
              this.CharBuffer.Fill(FileName, row, column);
            } else if (this.CharBuffer.isComment && this.CharBuffer.isString && !this.CharBuffer.inComment) {
              this.CharBuffer.isComment = false;
              this.CharBuffer.isString = false;
              this.CharBuffer.inComment = false;
            } else if (this.CharBuffer.isComment && !this.CharBuffer.isString && this.CharBuffer.inComment) {
              this.CharBuffer.isComment = true;
              this.CharBuffer.isString = false;
              this.CharBuffer.inComment = false;
            }
            if (this.CharBuffer.isComment) {
              this.CharBuffer.Append(char);
            } else {
              this.CharBuffer.Append(char);
              this.CharBuffer.Fill(FileName, row, column);
            }
            break;
          default:
            this.CharBuffer.Append(char);
            break;
        }
        this.CharBuffer.lastChar = char;
      },
      Serialize: function() {
        var Table = this.CharBuffer.Table;
        var ModuleName = "";
        for (var FileName in Table) {
          ModuleName = this.CharBuffer.ModuleName[FileName];
          this.SymbolBuffer[ModuleName] = [];
          var foundTheEnd = false;
          var lastGoodDeclaration = ["none"];
          var file = Table[FileName];
          for (var r = 0;r < file.length; r++) {
            var row = file[r];
            for (var c = 0;c < row.length; c++) {
              var symbol = row[c];
              var addSymbol = true;
              switch (symbol) {
                case "END":
                  foundTheEnd = true;
                  break;
                case "::=":
                  foundTheEnd = false;
                  lastGoodDeclaration = row;
                  break;
                default:
                  if (symbol.startsWith("--")) {
                    addSymbol = false;
                  } else {
                    foundTheEnd = false;
                  }
              }
              if (addSymbol) {
                this.SymbolBuffer[ModuleName].push(symbol);
              }
            }
          }
          if (!foundTheEnd) {
            console.warn('[%s]: Incorrect formatting: no END statement found - last good declaration "%s" (line %s)', ModuleName, lastGoodDeclaration.join(" "), lastGoodDeclaration.line);
          }
        }
        this.Compile();
      },
      Compile: function() {
        for (var ModuleName in this.SymbolBuffer) {
          if (this.SymbolBuffer.hasOwnProperty(ModuleName)) {
            if (!this.Modules[ModuleName]) {
              this.Modules[ModuleName] = {};
            }
            var Module = this.Modules[ModuleName];
            var Symbols = this.SymbolBuffer[ModuleName];
            var Object2 = Module;
            var MACROName = "";
            let unresolvedObjects = [];
            for (var i = 0;i < Symbols.length; i++) {
              switch (Symbols[i]) {
                case "::=":
                  const isObjectIdentifierAssignment = Symbols[i + 1].indexOf("{") == 0;
                  const isTrapTypeDefinition = Number.isInteger(Number.parseInt(Symbols[i + 1]));
                  if (isObjectIdentifierAssignment || isTrapTypeDefinition) {
                    let macroIndex = i - 1;
                    let found = false;
                    while (!found && macroIndex > 0) {
                      macroIndex--;
                      for (var m = 0;m < this.MACROS.length; m++) {
                        if (Symbols[macroIndex] == this.MACROS[m]) {
                          found = true;
                          break;
                        }
                      }
                    }
                    if (Symbols[i - 1] == "OBJECT IDENTIFIER") {
                      Object2[Symbols[i - 2]] = {};
                      Object2[Symbols[i - 2]]["ObjectName"] = Symbols[i - 2];
                      Object2[Symbols[i - 2]]["ModuleName"] = ModuleName;
                      Object2[Symbols[i - 2]]["OBJECT IDENTIFIER"] = Symbols[i + 1].replace("{", "").replace("}", "").trim().replace(/\s+/, " ");
                      if (Object2[Symbols[i - 2]]["OBJECT IDENTIFIER"] == "0 0") {
                        Object2[Symbols[i - 2]]["OID"] = "0.0";
                        Object2[Symbols[i - 2]]["NameSpace"] = "null";
                      } else {
                        const { oidString, nameString, unresolvedObject } = this.getOidAndNamePaths(Object2[Symbols[i - 2]]["OBJECT IDENTIFIER"], Symbols[i - 2], ModuleName);
                        Object2[Symbols[i - 2]]["OID"] = oidString;
                        Object2[Symbols[i - 2]]["NameSpace"] = nameString;
                        if (unresolvedObject) {
                          if (!unresolvedObjects.includes(unresolvedObject)) {
                            unresolvedObjects.push(unresolvedObject);
                          }
                        }
                      }
                    } else {
                      const ObjectName = Symbols[macroIndex - 1];
                      Object2[ObjectName] = {};
                      Object2[ObjectName]["ObjectName"] = ObjectName;
                      Object2[ObjectName]["ModuleName"] = ModuleName;
                      Object2[ObjectName]["MACRO"] = Symbols[macroIndex];
                      const MACRO = this[Symbols[macroIndex]];
                      let c1 = macroIndex;
                      const keychain = [];
                      keychain.push("DESCRIPTION");
                      let key;
                      for (let notation in MACRO["TYPE NOTATION"]) {
                        key = notation;
                        if (MACRO["TYPE NOTATION"][notation] == null) {
                          key = MACRO[notation]["MACRO"].replace(/"/g, "");
                        }
                        keychain.push(key);
                      }
                      while (c1 < i - 1) {
                        c1++;
                        key = Symbols[c1];
                        const regExp = /\(([^)]+)\)/;
                        if (keychain.indexOf(key) > -1 || key == "REVISION") {
                          let val = Symbols[c1 + 1].replace(/"/g, "");
                          if (val.indexOf("{") == 0) {
                            c1++;
                            while (Symbols[c1].indexOf("}") == -1) {
                              c1++;
                              val += Symbols[c1];
                            }
                            if (key == "DEFVAL") {
                              val = val.replace(/^{/, "").replace(/}$/, "").trim();
                            } else {
                              val = val.replace("{", "").replace("}", "").split(",").map((v) => v.trim());
                            }
                          }
                          switch (key) {
                            case "SYNTAX":
                              switch (val) {
                                case "BITS":
                                case "INTEGER":
                                case "Integer32":
                                  if (Symbols[c1 + 2].indexOf("{") == 0) {
                                    var valObj = val;
                                    val = {};
                                    val[valObj] = {};
                                    c1 = c1 + 1;
                                    var integer;
                                    var syntax;
                                    while (Symbols[c1].indexOf("}") == -1) {
                                      c1++;
                                      var ok = false;
                                      if (Symbols[c1].indexOf("(") == 0 && Symbols[c1].length > 1) {
                                        integer = regExp.exec(Symbols[c1]);
                                        syntax = Symbols[c1 - 1];
                                        ok = true;
                                      } else if (Symbols[c1].indexOf("(") > 0) {
                                        integer = regExp.exec(Symbols[c1]);
                                        syntax = Symbols[c1].split("(")[0];
                                        ok = true;
                                      }
                                      if (syntax && syntax.indexOf("{") == 0) {
                                        syntax = syntax.split("{")[1].trim();
                                      }
                                      if (ok) {
                                        val[valObj][integer[1]] = syntax;
                                      }
                                    }
                                  } else if (Symbols[c1 + 2].indexOf("(") == 0) {
                                    let valObj2 = val;
                                    val = {};
                                    val[valObj2] = {
                                      ranges: this.GetRanges(Symbols[c1 + 2])
                                    };
                                  }
                                  break;
                                case "OCTET STRING":
                                case "DisplayString":
                                  if (Symbols[c1 + 2].replace(/ */g, "").startsWith("(SIZE")) {
                                    let valObj2 = val;
                                    val = {};
                                    val[valObj2] = {
                                      sizes: this.GetRanges(Symbols[c1 + 2])
                                    };
                                  }
                                  break;
                                case "SEQUENCE OF":
                                  val += " " + Symbols[c1 + 2];
                                  c1 = c1 + 2;
                                  break;
                                default:
                                  break;
                              }
                              Object2[ObjectName][key] = val;
                              break;
                            case "DESCRIPTION":
                              if (!Object2[ObjectName][key]) {
                                Object2[ObjectName][key] = val;
                              }
                              if (!Object2[ObjectName]["REVISIONS-DESCRIPTIONS"]) {
                                Object2[ObjectName]["REVISIONS-DESCRIPTIONS"] = [];
                              }
                              Object2[ObjectName]["REVISIONS-DESCRIPTIONS"].push({
                                type: "DESCRIPTION",
                                value: val
                              });
                              break;
                            case "REVISION":
                              if (!Object2[ObjectName]["REVISIONS-DESCRIPTIONS"]) {
                                Object2[ObjectName]["REVISIONS-DESCRIPTIONS"] = [];
                              }
                              Object2[ObjectName]["REVISIONS-DESCRIPTIONS"].push({
                                type: "REVISION",
                                value: val
                              });
                              break;
                            default:
                              Object2[ObjectName][key] = val;
                              break;
                          }
                        }
                      }
                      Object2[Symbols[macroIndex - 1]]["ObjectName"] = Symbols[macroIndex - 1];
                      Object2[Symbols[macroIndex - 1]]["ModuleName"] = ModuleName;
                      if (isObjectIdentifierAssignment) {
                        Object2[Symbols[macroIndex - 1]]["OBJECT IDENTIFIER"] = Symbols[i + 1].replace("{", "").replace("}", "").trim().replace(/\s+/, " ");
                        if (Object2[Symbols[macroIndex - 1]]["OBJECT IDENTIFIER"] == "0 0") {
                          Object2[Symbols[macroIndex - 1]]["OID"] = "0.0";
                          Object2[Symbols[macroIndex - 1]]["NameSpace"] = "null";
                        } else {
                          const { oidString, nameString, unresolvedObject } = this.getOidAndNamePaths(Object2[Symbols[macroIndex - 1]]["OBJECT IDENTIFIER"], Symbols[macroIndex - 1], ModuleName);
                          Object2[Symbols[macroIndex - 1]]["OID"] = oidString;
                          Object2[Symbols[macroIndex - 1]]["NameSpace"] = nameString;
                          if (unresolvedObject) {
                            if (!unresolvedObjects.includes(unresolvedObject)) {
                              unresolvedObjects.push(unresolvedObject);
                            }
                          }
                        }
                      } else if (isTrapTypeDefinition) {
                        Object2[Symbols[macroIndex - 1]]["VALUE"] = Number.parseInt(Symbols[i + 1]);
                      }
                      if (Object2[Symbols[macroIndex - 1]]["REVISIONS-DESCRIPTIONS"] && Object2[Symbols[macroIndex - 1]]["REVISIONS-DESCRIPTIONS"].length == 1 && Object2[Symbols[macroIndex - 1]]["REVISIONS-DESCRIPTIONS"][0]["type"] == "DESCRIPTION") {
                        delete Object2[Symbols[macroIndex - 1]]["REVISIONS-DESCRIPTIONS"];
                      }
                    }
                  } else {
                    switch (Symbols[i - 1]) {
                      case "DEFINITIONS":
                        break;
                      case "OBJECT IDENTIFIER":
                        break;
                      case "MACRO":
                        Object2 = Object2[Symbols[i - 2]] = {};
                        MACROName = Symbols[i - 2];
                        break;
                      case "VALUE NOTATION":
                      case "TYPE NOTATION":
                        Object2[Symbols[i - 1]] = {};
                        var j = i + 1;
                        while (Symbols[j + 1] != "::=" && Symbols[j + 1] != "END") {
                          if (Symbols[j].indexOf('"') == 0) {
                            var value = Symbols[j + 1];
                            var t = j + 1;
                            if (Symbols[j + 2].indexOf("(") == 0) {
                              value = Symbols[j + 2];
                              t = j + 2;
                            }
                            Object2[Symbols[i - 1]][Symbols[j].replace(/"/g, "")] = value;
                            j = t;
                          } else {
                            Object2[Symbols[i - 1]][Symbols[j]] = null;
                            if (Symbols[j + 1].indexOf("(") == 0) {
                              Object2[Symbols[i - 1]][Symbols[j]] = Symbols[j + 1];
                              j++;
                            }
                          }
                          j++;
                        }
                        if (ModuleName == "SNMPv2-SMI") {
                          Object2["TYPE NOTATION"].INDEX = "Index";
                          Object2["TYPE NOTATION"].AUGMENTS = "Augments";
                          Object2["TYPE NOTATION"].ACCESS = "Access";
                        } else if (ModuleName == "RFC-1212") {
                          Object2["TYPE NOTATION"].INDEX = "Index";
                          Object2["TYPE NOTATION"].ACCESS = "Access";
                        }
                        break;
                      default:
                        Object2[Symbols[i - 1]] = {};
                        Object2[Symbols[i - 1]]["ObjectName"] = Symbols[i - 1];
                        Object2[Symbols[i - 1]]["ModuleName"] = ModuleName;
                        Object2[Symbols[i - 1]]["MACRO"] = Symbols[i + 1];
                        this.BuildObject(Object2, Symbols[i - 1], Symbols[i + 1], i, Symbols);
                        break;
                    }
                  }
                  break;
                case "END":
                  if (MACROName != "") {
                    this[MACROName] = Object2;
                    this.MACROS.push(MACROName);
                  }
                  Object2 = Module;
                  MACROName = "";
                  break;
                case "IMPORTS":
                  Module["IMPORTS"] = {};
                  var tmp = i + 1;
                  var IMPORTS = [];
                  while (Symbols[tmp] != ";") {
                    if (Symbols[tmp] == "FROM") {
                      var ImportModule = Symbols[tmp + 1];
                      if (!this.Modules[ImportModule]) {
                        console.log(ModuleName + ": Can not find " + ImportModule + "!!!!!!!!!!!!!!!!!!!!!");
                        console.log(ModuleName + ": Can not import ", IMPORTS);
                      }
                      Module["IMPORTS"][ImportModule] = IMPORTS;
                      tmp++;
                      IMPORTS = [];
                    } else if (Symbols[tmp] != ",") {
                      IMPORTS.push(Symbols[tmp]);
                    }
                    tmp++;
                  }
                  break;
                case "EXPORTS":
                  break;
                default:
                  break;
              }
            }
            if (unresolvedObjects.length > 0) {
              for (const unresolved of unresolvedObjects) {
                const obj = this.Modules[ModuleName][unresolved];
                const { oidString, nameString, unresolvedObject } = this.getOidAndNamePaths(obj["OBJECT IDENTIFIER"], unresolved, ModuleName);
                this.Modules[ModuleName][unresolved].NameSpace = nameString;
                this.Modules[ModuleName][unresolved].OID = oidString;
                if (unresolvedObject) {
                  if (obj.NameSpace) {
                    const unresolvedParent = obj.NameSpace.split(".")[1];
                    if (unresolvedParent !== obj.ObjectName) {
                      console.warn(`Unable to mount node '${obj.ObjectName}', cannot resolve parent object '${unresolvedParent}'.`);
                      continue;
                    }
                  }
                  console.warn(`Unable to mount node '${obj.ObjectName}', cannot resolve object identifier '${obj["OBJECT IDENTIFIER"]}'.`);
                }
              }
            }
          }
        }
      },
      GetRanges: function(mibRanges) {
        let rangesString = mibRanges.replace(/ */g, "").replace(/\(SIZE/, "").replace(/\)/, "").replace(/\(/, "").replace(/\)/, "");
        let rangeStrings = rangesString.split("|");
        let ranges = [];
        for (let rangeString of rangeStrings) {
          if (rangeString.includes("..")) {
            let range = rangeString.split("..");
            ranges.push({
              min: parseInt(range[0], 10),
              max: parseInt(range[1], 10)
            });
          } else {
            ranges.push({
              min: parseInt(rangeString, 10),
              max: parseInt(rangeString, 10)
            });
          }
        }
        return ranges;
      },
      BuildObject: function(Object2, ObjectName, macro, i, Symbols) {
        var syntaxKeyword = Symbols.indexOf("SYNTAX", i);
        var m = syntaxKeyword - i;
        var c1 = syntaxKeyword + 1;
        var SYNTAX = Symbols[c1];
        var val = Symbols[c1 + 1];
        if (this.MACROS.indexOf(macro) > -1 && m < 10) {
          if (val[0] === "{") {
            this.BuildObjectEnumeration(Object2, ObjectName, c1, SYNTAX, val, Symbols);
          } else if (val[0] === "(") {
            const key = val.startsWith("(SIZE") ? "sizes" : "ranges";
            Object2[ObjectName]["SYNTAX"] = {};
            Object2[ObjectName]["SYNTAX"][SYNTAX] = { [key]: this.GetRanges(val) };
          } else {
            Object2[ObjectName]["SYNTAX"] = SYNTAX;
          }
        } else if (Symbols[i + 1] == "INTEGER") {
          c1 = i + 1;
          SYNTAX = "INTEGER";
          val = Symbols[c1 + 1];
          if (val[0] === "{") {
            this.BuildObjectEnumeration(Object2, ObjectName, c1, SYNTAX, val, Symbols);
          }
        }
      },
      BuildObjectEnumeration: function(Object2, ObjectName, c1, SYNTAX, val, Symbols) {
        c1++;
        while (Symbols[c1].indexOf("}") == -1) {
          c1++;
          val += Symbols[c1].trim();
        }
        val = val.replace("{", "").replace("}", "").split(",");
        Object2[ObjectName]["SYNTAX"] = {};
        Object2[ObjectName]["SYNTAX"][SYNTAX] = {};
        for (var TC = 0;TC < val.length; TC++) {
          let openParenSplit = val[TC].split(/\s*\(\s*/);
          Object2[ObjectName]["SYNTAX"][SYNTAX][openParenSplit[1].replace(/\s*\)\s*$/, "")] = openParenSplit[0].trimStart();
        }
      },
      GetSummary: function(callback) {
        var summary = "";
        for (var ModuleName in this.Modules) {
          if (this.Modules.hasOwnProperty(ModuleName)) {
            for (var ObjectName in this.Modules[ModuleName]) {
              if (this.Modules[ModuleName].hasOwnProperty(ObjectName)) {
                if (this.Modules[ModuleName][ObjectName]["OID"]) {
                  summary += this.Modules[ModuleName][ObjectName]["OID"] + " : " + ObjectName + `\r
`;
                }
              }
            }
          }
        }
        callback(summary);
      },
      getOidAndNamePaths: function(OBJECT_IDENTIFIER, ObjectName, ModuleName) {
        const entries = OBJECT_IDENTIFIER.split(/\s+/);
        const parent = entries.shift();
        const finalEntries = entries.pop();
        const nameEntries = [];
        const oidEntries = [];
        for (const entry of entries) {
          const match = entry.match(/(.*)\((.+)\)$/);
          if (match) {
            oidEntries.push(match[2]);
            nameEntries.push(match[1]);
          } else {
            oidEntries.push(entry);
            nameEntries.push(entry);
          }
        }
        let finalOid;
        if (finalEntries.includes("(")) {
          const oidSplit = finalEntries.match(/(.*)\((.+)\)$/);
          finalOid = oidSplit[2];
        } else {
          finalOid = finalEntries;
        }
        oidEntries.push(finalOid);
        nameEntries.push(ObjectName);
        let parentOidPrefix;
        let parentNamePrefix;
        let unresolvedObject;
        if (parent == "iso") {
          parentOidPrefix = "1";
          parentNamePrefix = "iso";
        } else {
          let parentObject = this.Modules[ModuleName][parent];
          if (!parentObject) {
            const importModules = Object.keys(this.Modules[ModuleName]["IMPORTS"]);
            for (let importModule of importModules) {
              if (this.Modules[importModule][parent]) {
                parentObject = this.Modules[importModule][parent];
                break;
              }
            }
          }
          if (!parentObject) {
            unresolvedObject = ObjectName;
            return {
              oidString: "." + oidEntries.join("."),
              nameString: "." + nameEntries.join("."),
              unresolvedObject
            };
          }
          if (parentObject.OID.startsWith(".")) {
            unresolvedObject = ObjectName;
          }
          parentOidPrefix = parentObject["OID"];
          parentNamePrefix = parentObject["NameSpace"];
        }
        return {
          oidString: parentOidPrefix + "." + oidEntries.join("."),
          nameString: parentNamePrefix + "." + nameEntries.join("."),
          unresolvedObject: unresolvedObject || undefined
        };
      }
    };
    initializeBuffer(newMIB.CharBuffer);
    return newMIB;
  };
  module.exports = exports = MIB;
  exports.MIB = MIB;
  exports.native = undefined;
});

// node_modules/net-snmp/index.js
var __dirname = "/home/agungb/laros-watch-api/node_modules/net-snmp";
var ber = require_asn1_ber().Ber;
var smartbuffer = require_smartbuffer();
var dgram = __require("dgram");
var net = __require("net");
var events = __require("events");
var util = __require("util");
var crypto = __require("crypto");
var mibparser = require_mib();
var Buffer2 = __require("buffer").Buffer;
var DEBUG = false;
var MIN_SIGNED_INT32 = -2147483648;
var MAX_SIGNED_INT32 = 2147483647;
var MIN_UNSIGNED_INT32 = 0;
var MAX_UNSIGNED_INT32 = 4294967295;
var MAX_UNSIGNED_INT64 = 18446744073709552000;
var DES_IMPLEMENTATION = "library";
var debugfn = typeof global.debug === "function" ? global.trace ?? global.debug : console.debug;
function debug() {
  if (DEBUG) {
    debugfn.apply(this, arguments);
  }
}
function _expandConstantObject(object) {
  var keys = [];
  for (var key in object)
    keys.push(key);
  for (var i = 0;i < keys.length; i++)
    object[object[keys[i]]] = parseInt(keys[i]);
}
var ErrorStatus = {
  0: "NoError",
  1: "TooBig",
  2: "NoSuchName",
  3: "BadValue",
  4: "ReadOnly",
  5: "GeneralError",
  6: "NoAccess",
  7: "WrongType",
  8: "WrongLength",
  9: "WrongEncoding",
  10: "WrongValue",
  11: "NoCreation",
  12: "InconsistentValue",
  13: "ResourceUnavailable",
  14: "CommitFailed",
  15: "UndoFailed",
  16: "AuthorizationError",
  17: "NotWritable",
  18: "InconsistentName"
};
_expandConstantObject(ErrorStatus);
var ObjectType = {
  1: "Boolean",
  2: "Integer",
  3: "BitString",
  4: "OctetString",
  5: "Null",
  6: "OID",
  64: "IpAddress",
  65: "Counter",
  66: "Gauge",
  67: "TimeTicks",
  68: "Opaque",
  70: "Counter64",
  128: "NoSuchObject",
  129: "NoSuchInstance",
  130: "EndOfMibView"
};
_expandConstantObject(ObjectType);
ObjectType.INTEGER = ObjectType.Integer;
ObjectType["OCTET STRING"] = ObjectType.OctetString;
ObjectType["OBJECT IDENTIFIER"] = ObjectType.OID;
ObjectType.Integer32 = ObjectType.Integer;
ObjectType.Counter32 = ObjectType.Counter;
ObjectType.Gauge32 = ObjectType.Gauge;
ObjectType.Unsigned32 = ObjectType.Gauge32;
var PduType = {
  160: "GetRequest",
  161: "GetNextRequest",
  162: "GetResponse",
  163: "SetRequest",
  164: "Trap",
  165: "GetBulkRequest",
  166: "InformRequest",
  167: "TrapV2",
  168: "Report"
};
_expandConstantObject(PduType);
var TrapType = {
  0: "ColdStart",
  1: "WarmStart",
  2: "LinkDown",
  3: "LinkUp",
  4: "AuthenticationFailure",
  5: "EgpNeighborLoss",
  6: "EnterpriseSpecific"
};
_expandConstantObject(TrapType);
var SecurityLevel = {
  1: "noAuthNoPriv",
  2: "authNoPriv",
  3: "authPriv"
};
_expandConstantObject(SecurityLevel);
var AuthProtocols = {
  "1": "none",
  "2": "md5",
  "3": "sha",
  "4": "sha224",
  "5": "sha256",
  "6": "sha384",
  "7": "sha512"
};
_expandConstantObject(AuthProtocols);
var PrivProtocols = {
  "1": "none",
  "2": "des",
  "4": "aes",
  "6": "aes256b",
  "8": "aes256r"
};
_expandConstantObject(PrivProtocols);
var UsmStatsBase = "1.3.6.1.6.3.15.1.1";
var UsmStats = {
  "1": "Unsupported Security Level",
  "2": "Not In Time Window",
  "3": "Unknown User Name",
  "4": "Unknown Engine ID",
  "5": "Wrong Digest (incorrect password, community or key)",
  "6": "Decryption Error"
};
_expandConstantObject(UsmStats);
var UsmErrorType = {
  UNSUPPORTED_SECURITY_LEVEL: "1",
  NOT_IN_TIME_WINDOW: "2",
  UNKNOWN_USER_NAME: "3",
  UNKNOWN_ENGINE_ID: "4",
  WRONG_DIGESTS: "5",
  DECRYPTION_ERROR: "6"
};
var MibProviderType = {
  "1": "Scalar",
  "2": "Table"
};
_expandConstantObject(MibProviderType);
var Version1 = 0;
var Version2c = 1;
var Version3 = 3;
var AgentXPduType = {
  1: "Open",
  2: "Close",
  3: "Register",
  4: "Unregister",
  5: "Get",
  6: "GetNext",
  7: "GetBulk",
  8: "TestSet",
  9: "CommitSet",
  10: "UndoSet",
  11: "CleanupSet",
  12: "Notify",
  13: "Ping",
  14: "IndexAllocate",
  15: "IndexDeallocate",
  16: "AddAgentCaps",
  17: "RemoveAgentCaps",
  18: "Response"
};
var agentXPduTypesRequiringReadAccess = [5, 6, 7];
var agentXPduTypesRequiringWriteAccess = [8, 9, 10, 11, 14, 15, 16, 17];
_expandConstantObject(AgentXPduType);
var AccessControlModelType = {
  0: "None",
  1: "Simple"
};
_expandConstantObject(AccessControlModelType);
var AccessLevel = {
  0: "None",
  1: "ReadOnly",
  2: "ReadWrite"
};
_expandConstantObject(AccessLevel);
var MaxAccess = {
  0: "not-accessible",
  1: "accessible-for-notify",
  2: "read-only",
  3: "read-write",
  4: "read-create"
};
_expandConstantObject(MaxAccess);
var AccessToMaxAccess = {
  "not-accessible": "not-accessible",
  "read-only": "read-only",
  "read-write": "read-write",
  "write-only": "read-write"
};
var RowStatus = {
  1: "active",
  2: "notInService",
  3: "notReady",
  4: "createAndGo",
  5: "createAndWait",
  6: "destroy"
};
_expandConstantObject(RowStatus);
var ResponseInvalidCode = {
  1: "EIp4AddressSize",
  2: "EUnknownObjectType",
  3: "EUnknownPduType",
  4: "ECouldNotDecrypt",
  5: "EAuthFailure",
  6: "EReqResOidNoMatch",
  8: "EOutOfOrder",
  9: "EVersionNoMatch",
  10: "ECommunityNoMatch",
  11: "EUnexpectedReport",
  12: "EResponseNotHandled",
  13: "EUnexpectedResponse"
};
_expandConstantObject(ResponseInvalidCode);
var OidFormat = {
  oid: "oid",
  path: "path",
  module: "module"
};
function ResponseInvalidError(message, code, info) {
  this.name = "ResponseInvalidError";
  this.message = message;
  this.code = code;
  this.info = info;
  Error.captureStackTrace(this, ResponseInvalidError);
}
util.inherits(ResponseInvalidError, Error);
function RequestInvalidError(message) {
  this.name = "RequestInvalidError";
  this.message = message;
  Error.captureStackTrace(this, RequestInvalidError);
}
util.inherits(RequestInvalidError, Error);
function RequestFailedError(message, status) {
  this.name = "RequestFailedError";
  this.message = message;
  this.status = status;
  Error.captureStackTrace(this, RequestFailedError);
}
util.inherits(RequestFailedError, Error);
function RequestTimedOutError(message) {
  this.name = "RequestTimedOutError";
  this.message = message;
  Error.captureStackTrace(this, RequestTimedOutError);
}
util.inherits(RequestTimedOutError, Error);
function ProcessingError(message, error, rinfo, buffer) {
  this.name = "ProcessingError";
  this.message = message;
  this.error = error;
  this.rinfo = rinfo;
  this.buffer = buffer;
  Error.captureStackTrace(this, ProcessingError);
}
util.inherits(ProcessingError, Error);
function isVarbindError(varbind) {
  return !!(varbind.type == ObjectType.NoSuchObject || varbind.type == ObjectType.NoSuchInstance || varbind.type == ObjectType.EndOfMibView);
}
function varbindError(varbind) {
  return (ObjectType[varbind.type] || "NotAnError") + ": " + varbind.oid;
}
function oidFollowsOid(oidString, nextString) {
  var oid = { str: oidString, len: oidString.length, idx: 0 };
  var next = { str: nextString, len: nextString.length, idx: 0 };
  var dotCharCode = 46;
  function getNumber(item) {
    var n = 0;
    if (item.idx >= item.len)
      return null;
    while (item.idx < item.len) {
      var charCode = item.str.charCodeAt(item.idx++);
      if (charCode == dotCharCode)
        return n;
      n = (n ? n * 10 : n) + (charCode - 48);
    }
    return n;
  }
  while (true) {
    var oidNumber = getNumber(oid);
    var nextNumber = getNumber(next);
    if (oidNumber !== null) {
      if (nextNumber !== null) {
        if (nextNumber > oidNumber) {
          return true;
        } else if (nextNumber < oidNumber) {
          return false;
        }
      } else {
        return true;
      }
    } else {
      return true;
    }
  }
}
function oidInSubtree(oidString, nextString) {
  var oid = oidString.split(".");
  var next = nextString.split(".");
  if (oid.length > next.length)
    return false;
  for (var i = 0;i < oid.length; i++) {
    if (next[i] != oid[i])
      return false;
  }
  return true;
}
function readInt32(buffer) {
  var parsedInt = buffer.readInt();
  if (!Number.isInteger(parsedInt)) {
    throw new TypeError("Value read as integer " + parsedInt + " is not an integer");
  }
  if (parsedInt < MIN_SIGNED_INT32 || parsedInt > MAX_SIGNED_INT32) {
    throw new RangeError("Read integer " + parsedInt + " is outside the signed 32-bit range");
  }
  return parsedInt;
}
function readUint32(buffer) {
  var parsedInt = buffer.readInt();
  if (!Number.isInteger(parsedInt)) {
    throw new TypeError("Value read as integer " + parsedInt + " is not an integer");
  }
  parsedInt = parsedInt >>> 0;
  if (parsedInt < MIN_UNSIGNED_INT32 || parsedInt > MAX_UNSIGNED_INT32) {
    throw new RangeError("Read integer " + parsedInt + " is outside the unsigned 32-bit range");
  }
  return parsedInt;
}
function readUint64(buffer) {
  var value = buffer.readString(ObjectType.Counter64, true);
  return value;
}
function readIpAddress(buffer) {
  var bytes = buffer.readString(ObjectType.IpAddress, true);
  if (bytes.length != 4)
    throw new ResponseInvalidError("Length '" + bytes.length + "' of IP address '" + bytes.toString("hex") + "' is not 4", ResponseInvalidCode.EIp4AddressSize);
  var value = bytes[0] + "." + bytes[1] + "." + bytes[2] + "." + bytes[3];
  return value;
}
function readVarbindValue(buffer, type) {
  var value;
  if (type == ObjectType.Boolean) {
    value = buffer.readBoolean();
  } else if (type == ObjectType.Integer) {
    value = readInt32(buffer);
  } else if (type == ObjectType.BitString) {
    value = buffer.readBitString();
  } else if (type == ObjectType.OctetString) {
    value = buffer.readString(null, true);
  } else if (type == ObjectType.Null) {
    buffer.readByte();
    buffer.readByte();
    value = null;
  } else if (type == ObjectType.OID) {
    value = buffer.readOID();
  } else if (type == ObjectType.IpAddress) {
    value = readIpAddress(buffer);
  } else if (type == ObjectType.Counter) {
    value = readUint32(buffer);
  } else if (type == ObjectType.Gauge) {
    value = readUint32(buffer);
  } else if (type == ObjectType.TimeTicks) {
    value = readUint32(buffer);
  } else if (type == ObjectType.Opaque) {
    value = buffer.readString(ObjectType.Opaque, true);
  } else if (type == ObjectType.Counter64) {
    value = readUint64(buffer);
  } else if (type == ObjectType.NoSuchObject) {
    buffer.readByte();
    buffer.readByte();
    value = null;
  } else if (type == ObjectType.NoSuchInstance) {
    buffer.readByte();
    buffer.readByte();
    value = null;
  } else if (type == ObjectType.EndOfMibView) {
    buffer.readByte();
    buffer.readByte();
    value = null;
  } else {
    throw new ResponseInvalidError("Unknown type '" + type + "' in response", ResponseInvalidCode.EUnknownObjectType);
  }
  return value;
}
function readVarbinds(buffer, varbinds) {
  buffer.readSequence();
  while (true) {
    buffer.readSequence();
    if (buffer.peek() != ObjectType.OID)
      break;
    var oid = buffer.readOID();
    var type = buffer.peek();
    if (type == null)
      break;
    var value = readVarbindValue(buffer, type);
    varbinds.push({
      oid,
      type,
      value
    });
  }
}
function writeInt32(buffer, type, value) {
  if (!Number.isInteger(value)) {
    throw new TypeError("Value to write as integer " + value + " is not an integer");
  }
  if (value < MIN_SIGNED_INT32 || value > MAX_SIGNED_INT32) {
    throw new RangeError("Integer to write " + value + " is outside the signed 32-bit range");
  }
  buffer.writeInt(value, type);
}
function writeUint32(buffer, type, value) {
  if (!Number.isInteger(value)) {
    throw new TypeError("Value to write as integer " + value + " is not an integer");
  }
  if (value < MIN_UNSIGNED_INT32 || value > MAX_UNSIGNED_INT32) {
    throw new RangeError("Integer to write " + value + " is outside the unsigned 32-bit range");
  }
  buffer.writeInt(value, type);
}
function writeUint64(buffer, value) {
  buffer.writeBuffer(value, ObjectType.Counter64);
}
function writeVarbinds(buffer, varbinds) {
  buffer.startSequence();
  for (var i = 0;i < varbinds.length; i++) {
    buffer.startSequence();
    buffer.writeOID(varbinds[i].oid);
    if (varbinds[i].type && varbinds[i].hasOwnProperty("value")) {
      var type = varbinds[i].type;
      var value = varbinds[i].value;
      switch (type) {
        case ObjectType.Boolean:
          buffer.writeBoolean(value ? true : false);
          break;
        case ObjectType.Integer:
          writeInt32(buffer, ObjectType.Integer, value);
          break;
        case ObjectType.OctetString:
          if (typeof value == "string")
            buffer.writeString(value);
          else
            buffer.writeBuffer(value, ObjectType.OctetString);
          break;
        case ObjectType.Null:
          buffer.writeNull();
          break;
        case ObjectType.OID:
          buffer.writeOID(value);
          break;
        case ObjectType.IpAddress:
          var bytes = value.split(".");
          if (bytes.length != 4)
            throw new RequestInvalidError("Invalid IP address '" + value + "'");
          buffer.writeBuffer(Buffer2.from(bytes), 64);
          break;
        case ObjectType.Counter:
          writeUint32(buffer, ObjectType.Counter, value);
          break;
        case ObjectType.Gauge:
          writeUint32(buffer, ObjectType.Gauge, value);
          break;
        case ObjectType.TimeTicks:
          writeUint32(buffer, ObjectType.TimeTicks, value);
          break;
        case ObjectType.Opaque:
          buffer.writeBuffer(value, ObjectType.Opaque);
          break;
        case ObjectType.Counter64:
          writeUint64(buffer, value);
          break;
        case ObjectType.NoSuchObject:
        case ObjectType.NoSuchInstance:
        case ObjectType.EndOfMibView:
          buffer.writeByte(type);
          buffer.writeByte(0);
          break;
        default:
          throw new RequestInvalidError("Unknown type '" + type + "' in request");
      }
    } else {
      buffer.writeNull();
    }
    buffer.endSequence();
  }
  buffer.endSequence();
}
var ObjectTypeUtil = {};
ObjectTypeUtil.castSetValue = function(type, value, constraints) {
  switch (type) {
    case ObjectType.Boolean: {
      return !!value;
    }
    case ObjectType.Integer:
    case ObjectType.Integer32: {
      if (typeof value != "number" && typeof value != "string") {
        throw new Error("Invalid Integer", value);
      }
      const parsedValue = typeof value == "number" ? value : parseInt(value, 10);
      if (isNaN(parsedValue)) {
        throw new Error("Invalid Integer", value);
      }
      if (constraints && !ObjectTypeUtil.doesIntegerMeetConstraints(parsedValue, constraints)) {
        throw new Error("Integer does not meet constraints", value);
      }
      return parsedValue;
    }
    case ObjectType.OctetString: {
      if (!(value instanceof Buffer2 || typeof value == "string")) {
        throw new Error("Invalid OctetString", value);
      }
      if (constraints && !ObjectTypeUtil.doesStringMeetConstraints(value, constraints)) {
        throw new Error("OctetString does not meet constraints", value);
      }
      if (value instanceof Buffer2) {
        return value.toString();
      } else {
        return value;
      }
    }
    case ObjectType.OID: {
      if (typeof value != "string" || !value.match(/^([0-9]+)(\.[0-9]+)+$/)) {
        throw new Error("Invalid OID", value);
      }
      return value;
    }
    case ObjectType.Counter:
    case ObjectType.Counter32:
    case ObjectType.Gauge:
    case ObjectType.Gauge32:
    case ObjectType.Unsigned32: {
      const parsedValue = parseInt(value, 10);
      if (isNaN(parsedValue)) {
        throw new Error(`Invalid Integer for ${type}`, value);
      }
      if (parsedValue < 0) {
        throw new Error(`Integer is negative for ${type}`, value);
      }
      if (parsedValue > MAX_UNSIGNED_INT32) {
        throw new Error(`Integer is greater than max unsigned int32 for ${type}`, value);
      }
      return parsedValue;
    }
    case ObjectType.Counter64: {
      if (value instanceof Buffer2) {
        if (value.length !== 8) {
          throw new Error(`Counter64 buffer is not 8 bytes`, value);
        }
        return value;
      }
      const parsedValue = parseInt(value, 10);
      if (isNaN(parsedValue)) {
        throw new Error(`Invalid Integer for Counter64`, value);
      }
      if (parsedValue < 0) {
        throw new Error(`Integer is negative for Counter64`, value);
      }
      if (parsedValue > MAX_UNSIGNED_INT64) {
        throw new Error(`Integer is greater than max unsigned int64 for Counter64`, value);
      }
      return parsedValue;
    }
    case ObjectType.IpAddress: {
      const octets = value.split(".");
      if (typeof value != "string" || octets.length != 4) {
        throw new Error("Invalid IpAddress", value);
      }
      for (const octet of octets) {
        if (isNaN(octet)) {
          throw new Error("Invalid IpAddress", value);
        }
        if (parseInt(octet) < 0 || parseInt(octet) > 255) {
          throw new Error("Invalid IpAddress", value);
        }
      }
      return value;
    }
    default: {
      return value;
    }
  }
};
ObjectTypeUtil.isValid = function(type, value, constraints) {
  switch (type) {
    case ObjectType.Boolean: {
      return typeof value == "boolean";
    }
    case ObjectType.Integer:
    case ObjectType.Integer32: {
      const parsedValue = Number(value);
      if (isNaN(parsedValue) || !Number.isInteger(parsedValue) || parsedValue < MIN_SIGNED_INT32 || parsedValue > MAX_SIGNED_INT32) {
        return false;
      }
      if (constraints && !ObjectTypeUtil.doesIntegerMeetConstraints(parsedValue, constraints)) {
        return false;
      }
      return true;
    }
    case ObjectType.OctetString: {
      if (typeof value != "string" && !(value instanceof Buffer2)) {
        return false;
      }
      if (constraints && !ObjectTypeUtil.doesStringMeetConstraints(value, constraints)) {
        return false;
      }
      return true;
    }
    case ObjectType.OID: {
      return typeof value == "string" && value.match(/^([0-9]+)(\.[0-9]+)+$/);
    }
    case ObjectType.Counter:
    case ObjectType.Counter32:
    case ObjectType.Gauge:
    case ObjectType.Gauge32:
    case ObjectType.Unsigned32: {
      const parsed = Number(value);
      return !isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_UNSIGNED_INT32;
    }
    case ObjectType.Counter64: {
      if (value instanceof Buffer2) {
        return value.length == 8;
      } else {
        const parsed = Number(value);
        return !isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0;
      }
    }
    case ObjectType.IpAddress: {
      const octets = value.split(".");
      if (octets.length !== 4) {
        return false;
      }
      for (const octet of octets) {
        if (isNaN(octet)) {
          return false;
        }
        if (parseInt(octet) < 0 || parseInt(octet) > 255) {
          return false;
        }
      }
      return true;
    }
    default: {
      return true;
    }
  }
};
ObjectTypeUtil.doesIntegerMeetConstraints = function(value, constraints) {
  if (!constraints) {
    return true;
  }
  if (constraints.enumeration) {
    if (constraints.enumeration[value]) {
      return true;
    } else {
      return false;
    }
  } else if (constraints.ranges) {
    for (const range of constraints.ranges) {
      const min = "min" in range ? range.min : Number.MIN_SAFE_INTEGER;
      const max = "max" in range ? range.max : Number.MAX_SAFE_INTEGER;
      if (value >= min && value <= max) {
        return true;
      }
    }
    return false;
  }
  return true;
};
ObjectTypeUtil.doesStringMeetConstraints = function(value, constraints) {
  if (!constraints) {
    return true;
  }
  if (constraints.sizes) {
    if (value.length === undefined) {
      return false;
    }
    const len = value.length;
    for (const range of constraints.sizes) {
      const min = "min" in range ? range.min : Number.MIN_SAFE_INTEGER;
      const max = "max" in range ? range.max : Number.MAX_SAFE_INTEGER;
      if (len >= min && len <= max) {
        return true;
      }
    }
    return false;
  }
  return true;
};
ObjectTypeUtil.getEnumerationNumberFromName = function(enumeration, name) {
  for (const [enumNumber, enumName] of Object.entries(enumeration)) {
    if (enumName === name) {
      return Number(enumNumber);
    }
  }
  return null;
};
var SimplePdu = function() {};
SimplePdu.prototype.toBuffer = function(buffer) {
  buffer.startSequence(this.type);
  writeInt32(buffer, ObjectType.Integer, this.id);
  writeInt32(buffer, ObjectType.Integer, this.type == PduType.GetBulkRequest ? this.options.nonRepeaters || 0 : 0);
  writeInt32(buffer, ObjectType.Integer, this.type == PduType.GetBulkRequest ? this.options.maxRepetitions || 0 : 0);
  writeVarbinds(buffer, this.varbinds);
  buffer.endSequence();
};
SimplePdu.prototype.initializeFromVariables = function(id, varbinds, options) {
  this.id = id;
  this.varbinds = varbinds;
  this.options = options || {};
  this.contextName = options && options.context ? options.context : "";
};
SimplePdu.prototype.initializeFromBuffer = function(reader) {
  this.type = reader.peek();
  reader.readSequence();
  this.id = readInt32(reader);
  this.nonRepeaters = readInt32(reader);
  this.maxRepetitions = readInt32(reader);
  this.varbinds = [];
  readVarbinds(reader, this.varbinds);
};
SimplePdu.prototype.getResponsePduForRequest = function() {
  var responsePdu = GetResponsePdu.createFromVariables(this.id, [], {});
  if (this.contextEngineID) {
    responsePdu.contextEngineID = this.contextEngineID;
    responsePdu.contextName = this.contextName;
  }
  return responsePdu;
};
SimplePdu.createFromVariables = function(pduClass, id, varbinds, options) {
  var pdu = new pduClass(id, varbinds, options);
  pdu.id = id;
  pdu.varbinds = varbinds;
  pdu.options = options || {};
  pdu.contextName = options && options.context ? options.context : "";
  return pdu;
};
var GetBulkRequestPdu = function() {
  this.type = PduType.GetBulkRequest;
  GetBulkRequestPdu.super_.apply(this, arguments);
};
util.inherits(GetBulkRequestPdu, SimplePdu);
GetBulkRequestPdu.createFromBuffer = function(reader) {
  var pdu = new GetBulkRequestPdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
var GetNextRequestPdu = function() {
  this.type = PduType.GetNextRequest;
  GetNextRequestPdu.super_.apply(this, arguments);
};
util.inherits(GetNextRequestPdu, SimplePdu);
GetNextRequestPdu.createFromBuffer = function(reader) {
  var pdu = new GetNextRequestPdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
var GetRequestPdu = function() {
  this.type = PduType.GetRequest;
  GetRequestPdu.super_.apply(this, arguments);
};
util.inherits(GetRequestPdu, SimplePdu);
GetRequestPdu.createFromBuffer = function(reader) {
  var pdu = new GetRequestPdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
GetRequestPdu.createFromVariables = function(id, varbinds, options) {
  var pdu = new GetRequestPdu;
  pdu.initializeFromVariables(id, varbinds, options);
  return pdu;
};
var InformRequestPdu = function() {
  this.type = PduType.InformRequest;
  InformRequestPdu.super_.apply(this, arguments);
};
util.inherits(InformRequestPdu, SimplePdu);
InformRequestPdu.createFromBuffer = function(reader) {
  var pdu = new InformRequestPdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
var SetRequestPdu = function() {
  this.type = PduType.SetRequest;
  SetRequestPdu.super_.apply(this, arguments);
};
util.inherits(SetRequestPdu, SimplePdu);
SetRequestPdu.createFromBuffer = function(reader) {
  var pdu = new SetRequestPdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
var TrapPdu = function() {
  this.type = PduType.Trap;
};
TrapPdu.prototype.toBuffer = function(buffer) {
  buffer.startSequence(this.type);
  buffer.writeOID(this.enterprise);
  buffer.writeBuffer(Buffer2.from(this.agentAddr.split(".")), ObjectType.IpAddress);
  writeInt32(buffer, ObjectType.Integer, this.generic);
  writeInt32(buffer, ObjectType.Integer, this.specific);
  writeUint32(buffer, ObjectType.TimeTicks, this.upTime || Math.floor(process.uptime() * 100));
  writeVarbinds(buffer, this.varbinds);
  buffer.endSequence();
};
TrapPdu.createFromBuffer = function(reader) {
  var pdu = new TrapPdu;
  reader.readSequence();
  pdu.enterprise = reader.readOID();
  pdu.agentAddr = readIpAddress(reader);
  pdu.generic = readInt32(reader);
  pdu.specific = readInt32(reader);
  pdu.upTime = readUint32(reader);
  pdu.varbinds = [];
  readVarbinds(reader, pdu.varbinds);
  return pdu;
};
TrapPdu.createFromVariables = function(typeOrOid, varbinds, options) {
  var pdu = new TrapPdu;
  pdu.agentAddr = options.agentAddr || "127.0.0.1";
  pdu.upTime = options.upTime;
  if (typeof typeOrOid == "string") {
    pdu.generic = TrapType.EnterpriseSpecific;
    pdu.specific = parseInt(typeOrOid.match(/\.(\d+)$/)[1]);
    pdu.enterprise = typeOrOid.replace(/\.(\d+)$/, "");
  } else {
    pdu.generic = typeOrOid;
    pdu.specific = 0;
    pdu.enterprise = "1.3.6.1.4.1";
  }
  pdu.varbinds = varbinds;
  return pdu;
};
var TrapV2Pdu = function() {
  this.type = PduType.TrapV2;
  TrapV2Pdu.super_.apply(this, arguments);
};
util.inherits(TrapV2Pdu, SimplePdu);
TrapV2Pdu.createFromBuffer = function(reader) {
  var pdu = new TrapV2Pdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
TrapV2Pdu.createFromVariables = function(id, varbinds, options) {
  var pdu = new TrapV2Pdu;
  pdu.initializeFromVariables(id, varbinds, options);
  return pdu;
};
var SimpleResponsePdu = function() {};
SimpleResponsePdu.prototype.toBuffer = function(writer) {
  writer.startSequence(this.type);
  writeInt32(writer, ObjectType.Integer, this.id);
  writeInt32(writer, ObjectType.Integer, this.errorStatus || 0);
  writeInt32(writer, ObjectType.Integer, this.errorIndex || 0);
  writeVarbinds(writer, this.varbinds);
  writer.endSequence();
};
SimpleResponsePdu.prototype.initializeFromBuffer = function(reader) {
  reader.readSequence(this.type);
  this.id = readInt32(reader);
  this.errorStatus = readInt32(reader);
  this.errorIndex = readInt32(reader);
  this.varbinds = [];
  readVarbinds(reader, this.varbinds);
};
SimpleResponsePdu.prototype.initializeFromVariables = function(id, varbinds, options) {
  this.id = id;
  this.varbinds = varbinds;
  this.options = options || {};
};
var GetResponsePdu = function() {
  this.type = PduType.GetResponse;
  GetResponsePdu.super_.apply(this, arguments);
};
util.inherits(GetResponsePdu, SimpleResponsePdu);
GetResponsePdu.createFromBuffer = function(reader) {
  var pdu = new GetResponsePdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
GetResponsePdu.createFromVariables = function(id, varbinds, options) {
  var pdu = new GetResponsePdu;
  pdu.initializeFromVariables(id, varbinds, options);
  return pdu;
};
var ReportPdu = function() {
  this.type = PduType.Report;
  ReportPdu.super_.apply(this, arguments);
};
util.inherits(ReportPdu, SimpleResponsePdu);
ReportPdu.createFromBuffer = function(reader) {
  var pdu = new ReportPdu;
  pdu.initializeFromBuffer(reader);
  return pdu;
};
ReportPdu.createFromVariables = function(id, varbinds, options) {
  var pdu = new ReportPdu;
  pdu.initializeFromVariables(id, varbinds, options);
  return pdu;
};
var readPdu = function(reader, scoped) {
  var pdu;
  var contextEngineID;
  var contextName;
  if (scoped) {
    reader = new ber.Reader(reader.readString(ber.Sequence | ber.Constructor, true));
    contextEngineID = reader.readString(ber.OctetString, true);
    contextName = reader.readString();
  }
  var type = reader.peek();
  if (type == PduType.GetResponse) {
    pdu = GetResponsePdu.createFromBuffer(reader);
  } else if (type == PduType.Report) {
    pdu = ReportPdu.createFromBuffer(reader);
  } else if (type == PduType.Trap) {
    pdu = TrapPdu.createFromBuffer(reader);
  } else if (type == PduType.TrapV2) {
    pdu = TrapV2Pdu.createFromBuffer(reader);
  } else if (type == PduType.InformRequest) {
    pdu = InformRequestPdu.createFromBuffer(reader);
  } else if (type == PduType.GetRequest) {
    pdu = GetRequestPdu.createFromBuffer(reader);
  } else if (type == PduType.SetRequest) {
    pdu = SetRequestPdu.createFromBuffer(reader);
  } else if (type == PduType.GetNextRequest) {
    pdu = GetNextRequestPdu.createFromBuffer(reader);
  } else if (type == PduType.GetBulkRequest) {
    pdu = GetBulkRequestPdu.createFromBuffer(reader);
  } else {
    throw new ResponseInvalidError("Unknown PDU type '" + type + "' in response", ResponseInvalidCode.EUnknownPduType);
  }
  if (scoped) {
    pdu.contextEngineID = contextEngineID;
    pdu.contextName = contextName;
  }
  pdu.scoped = scoped;
  return pdu;
};
var createDiscoveryPdu = function(context) {
  return GetRequestPdu.createFromVariables(_generateId(), [], { context });
};
var Authentication = {};
Authentication.HMAC_BUFFER_SIZE = 1024 * 1024;
Authentication.algorithms = {};
Authentication.algorithms[AuthProtocols.md5] = {
  KEY_LENGTH: 16,
  AUTHENTICATION_CODE_LENGTH: 12,
  CRYPTO_ALGORITHM: "md5"
};
Authentication.algorithms[AuthProtocols.sha] = {
  KEY_LENGTH: 20,
  AUTHENTICATION_CODE_LENGTH: 12,
  CRYPTO_ALGORITHM: "sha1"
};
Authentication.algorithms[AuthProtocols.sha224] = {
  KEY_LENGTH: 28,
  AUTHENTICATION_CODE_LENGTH: 16,
  CRYPTO_ALGORITHM: "sha224"
};
Authentication.algorithms[AuthProtocols.sha256] = {
  KEY_LENGTH: 32,
  AUTHENTICATION_CODE_LENGTH: 24,
  CRYPTO_ALGORITHM: "sha256"
};
Authentication.algorithms[AuthProtocols.sha384] = {
  KEY_LENGTH: 48,
  AUTHENTICATION_CODE_LENGTH: 32,
  CRYPTO_ALGORITHM: "sha384"
};
Authentication.algorithms[AuthProtocols.sha512] = {
  KEY_LENGTH: 64,
  AUTHENTICATION_CODE_LENGTH: 48,
  CRYPTO_ALGORITHM: "sha512"
};
Authentication.authToKeyCache = {};
Authentication.computeCacheKey = function(authProtocol, authPasswordString, engineID) {
  var engineIDString = engineID.toString("base64");
  return authProtocol + authPasswordString + engineIDString;
};
Authentication.passwordToKey = function(authProtocol, authPasswordString, engineID) {
  var hashAlgorithm;
  var firstDigest;
  var finalDigest;
  var buf;
  var cryptoAlgorithm = Authentication.algorithms[authProtocol].CRYPTO_ALGORITHM;
  var cacheKey = Authentication.computeCacheKey(authProtocol, authPasswordString, engineID);
  if (Authentication.authToKeyCache[cacheKey] !== undefined) {
    return Authentication.authToKeyCache[cacheKey];
  }
  buf = Buffer2.alloc(Authentication.HMAC_BUFFER_SIZE, authPasswordString);
  hashAlgorithm = crypto.createHash(cryptoAlgorithm);
  hashAlgorithm.update(buf);
  firstDigest = hashAlgorithm.digest();
  hashAlgorithm = crypto.createHash(cryptoAlgorithm);
  hashAlgorithm.update(firstDigest);
  hashAlgorithm.update(engineID);
  hashAlgorithm.update(firstDigest);
  finalDigest = hashAlgorithm.digest();
  Authentication.authToKeyCache[cacheKey] = finalDigest;
  return finalDigest;
};
Authentication.getParametersLength = function(authProtocol) {
  return Authentication.algorithms[authProtocol].AUTHENTICATION_CODE_LENGTH;
};
Authentication.writeParameters = function(messageBuffer, authProtocol, authPassword, engineID, digestInMessage) {
  var digestToAdd;
  digestToAdd = Authentication.calculateDigest(messageBuffer, authProtocol, authPassword, engineID);
  digestToAdd.copy(digestInMessage);
};
Authentication.isAuthentic = function(messageBuffer, authProtocol, authPassword, engineID, digestInMessage) {
  var savedDigest;
  var calculatedDigest;
  if (digestInMessage.length !== Authentication.algorithms[authProtocol].AUTHENTICATION_CODE_LENGTH)
    return false;
  savedDigest = Buffer2.from(digestInMessage);
  digestInMessage.fill(0);
  calculatedDigest = Authentication.calculateDigest(messageBuffer, authProtocol, authPassword, engineID);
  savedDigest.copy(digestInMessage);
  return calculatedDigest.equals(digestInMessage);
};
Authentication.calculateDigest = function(messageBuffer, authProtocol, authPassword, engineID) {
  var authKey = Authentication.passwordToKey(authProtocol, authPassword, engineID);
  var cryptoAlgorithm = Authentication.algorithms[authProtocol].CRYPTO_ALGORITHM;
  var hmacAlgorithm = crypto.createHmac(cryptoAlgorithm, authKey);
  hmacAlgorithm.update(messageBuffer);
  var digest = hmacAlgorithm.digest();
  return digest.subarray(0, Authentication.algorithms[authProtocol].AUTHENTICATION_CODE_LENGTH);
};
var Encryption = {};
Encryption.encryptPdu = function(privProtocol, scopedPdu, privPassword, authProtocol, engine) {
  var encryptFunction = Encryption.algorithms[privProtocol].encryptPdu;
  return encryptFunction(scopedPdu, privProtocol, privPassword, authProtocol, engine);
};
Encryption.decryptPdu = function(privProtocol, encryptedPdu, privParameters, privPassword, authProtocol, engine) {
  var decryptFunction = Encryption.algorithms[privProtocol].decryptPdu;
  return decryptFunction(encryptedPdu, privProtocol, privParameters, privPassword, authProtocol, engine);
};
Encryption.debugEncrypt = function(encryptionKey, iv, plainPdu, encryptedPdu) {
  debug("Key: " + encryptionKey.toString("hex"));
  debug("IV:  " + iv.toString("hex"));
  debug("Plain:     " + plainPdu.toString("hex"));
  debug("Encrypted: " + encryptedPdu.toString("hex"));
};
Encryption.debugDecrypt = function(decryptionKey, iv, encryptedPdu, plainPdu) {
  debug("Key: " + decryptionKey.toString("hex"));
  debug("IV:  " + iv.toString("hex"));
  debug("Encrypted: " + encryptedPdu.toString("hex"));
  debug("Plain:     " + plainPdu.toString("hex"));
};
Encryption.generateLocalizedKey = function(algorithm, authProtocol, privPassword, engineID) {
  var privLocalizedKey;
  var encryptionKey;
  privLocalizedKey = Authentication.passwordToKey(authProtocol, privPassword, engineID);
  encryptionKey = Buffer2.alloc(algorithm.KEY_LENGTH);
  privLocalizedKey.copy(encryptionKey, 0, 0, algorithm.KEY_LENGTH);
  return encryptionKey;
};
Encryption.generateLocalizedKeyBlumenthal = function(algorithm, authProtocol, privPassword, engineID) {
  let authKeyLength;
  let privLocalizedKey;
  let encryptionKey;
  let rounds;
  let hashInput;
  let nextHash;
  let hashAlgorithm;
  authKeyLength = Authentication.algorithms[authProtocol].KEY_LENGTH;
  rounds = Math.ceil(algorithm.KEY_LENGTH / authKeyLength);
  encryptionKey = Buffer2.alloc(algorithm.KEY_LENGTH);
  privLocalizedKey = Authentication.passwordToKey(authProtocol, privPassword, engineID);
  nextHash = privLocalizedKey;
  for (let round = 0;round < rounds; round++) {
    nextHash.copy(encryptionKey, round * authKeyLength, 0, authKeyLength);
    if (round < rounds - 1) {
      hashAlgorithm = crypto.createHash(Authentication.algorithms[authProtocol].CRYPTO_ALGORITHM);
      hashInput = Buffer2.alloc((round + 1) * authKeyLength);
      encryptionKey.copy(hashInput, round * authKeyLength, 0, (round + 1) * authKeyLength);
      hashAlgorithm.update(hashInput);
      nextHash = hashAlgorithm.digest();
    }
  }
  return encryptionKey;
};
Encryption.generateLocalizedKeyReeder = function(algorithm, authProtocol, privPassword, engineID) {
  let authKeyLength;
  let privLocalizedKey;
  let encryptionKey;
  let rounds;
  let nextPasswordInput;
  authKeyLength = Authentication.algorithms[authProtocol].KEY_LENGTH;
  rounds = Math.ceil(algorithm.KEY_LENGTH / authKeyLength);
  encryptionKey = Buffer2.alloc(algorithm.KEY_LENGTH);
  nextPasswordInput = privPassword;
  for (let round = 0;round < rounds; round++) {
    privLocalizedKey = Authentication.passwordToKey(authProtocol, nextPasswordInput, engineID);
    privLocalizedKey.copy(encryptionKey, round * authKeyLength, 0, authKeyLength);
    nextPasswordInput = privLocalizedKey;
  }
  return encryptionKey;
};
Encryption.encryptPduDes = function(scopedPdu, privProtocol, privPassword, authProtocol, engine) {
  var des = Encryption.algorithms[PrivProtocols.des];
  var privLocalizedKey;
  var encryptionKey;
  var preIv;
  var salt;
  var iv;
  var i;
  var paddedScopedPduLength;
  var paddedScopedPdu;
  var encryptedPdu;
  encryptionKey = Encryption.generateLocalizedKey(des, authProtocol, privPassword, engine.engineID);
  privLocalizedKey = Authentication.passwordToKey(authProtocol, privPassword, engine.engineID);
  encryptionKey = Buffer2.alloc(des.KEY_LENGTH);
  privLocalizedKey.copy(encryptionKey, 0, 0, des.KEY_LENGTH);
  preIv = Buffer2.alloc(des.BLOCK_LENGTH);
  privLocalizedKey.copy(preIv, 0, des.KEY_LENGTH, des.KEY_LENGTH + des.BLOCK_LENGTH);
  salt = Buffer2.alloc(des.BLOCK_LENGTH);
  salt.fill("00000001", 0, 4, "hex");
  salt.fill(crypto.randomBytes(4), 4, 8);
  iv = Buffer2.alloc(des.BLOCK_LENGTH);
  for (i = 0;i < iv.length; i++) {
    iv[i] = preIv[i] ^ salt[i];
  }
  if (scopedPdu.length % des.BLOCK_LENGTH == 0) {
    paddedScopedPdu = scopedPdu;
  } else {
    paddedScopedPduLength = des.BLOCK_LENGTH * (Math.floor(scopedPdu.length / des.BLOCK_LENGTH) + 1);
    paddedScopedPdu = Buffer2.alloc(paddedScopedPduLength);
    scopedPdu.copy(paddedScopedPdu, 0, 0, scopedPdu.length);
  }
  if (DES_IMPLEMENTATION === "native") {} else {
    const cipher = crypto.createCipheriv(des.CRYPTO_ALGORITHM, encryptionKey, iv);
    encryptedPdu = cipher.update(paddedScopedPdu);
    encryptedPdu = Buffer2.concat([encryptedPdu, cipher.final()]);
  }
  return {
    encryptedPdu,
    msgPrivacyParameters: salt
  };
};
Encryption.decryptPduDes = function(encryptedPdu, privProtocol, privParameters, privPassword, authProtocol, engine) {
  var des = Encryption.algorithms[PrivProtocols.des];
  var privLocalizedKey;
  var decryptionKey;
  var preIv;
  var salt;
  var iv;
  var i;
  var decryptedPdu;
  privLocalizedKey = Authentication.passwordToKey(authProtocol, privPassword, engine.engineID);
  decryptionKey = Buffer2.alloc(des.KEY_LENGTH);
  privLocalizedKey.copy(decryptionKey, 0, 0, des.KEY_LENGTH);
  preIv = Buffer2.alloc(des.BLOCK_LENGTH);
  privLocalizedKey.copy(preIv, 0, des.KEY_LENGTH, des.KEY_LENGTH + des.BLOCK_LENGTH);
  salt = privParameters;
  iv = Buffer2.alloc(des.BLOCK_LENGTH);
  for (i = 0;i < iv.length; i++) {
    iv[i] = preIv[i] ^ salt[i];
  }
  if (DES_IMPLEMENTATION === "native") {} else {
    const decipher = crypto.createDecipheriv(des.CRYPTO_ALGORITHM, decryptionKey, iv);
    decipher.setAutoPadding(false);
    decryptedPdu = decipher.update(encryptedPdu);
    decryptedPdu = Buffer2.concat([decryptedPdu, decipher.final()]);
  }
  return decryptedPdu;
};
Encryption.generateIvAes = function(aes, engineBoots, engineTime, salt) {
  var iv;
  var engineBootsBuffer;
  var engineTimeBuffer;
  iv = Buffer2.alloc(aes.BLOCK_LENGTH);
  engineBootsBuffer = Buffer2.alloc(4);
  engineBootsBuffer.writeUInt32BE(engineBoots);
  engineTimeBuffer = Buffer2.alloc(4);
  engineTimeBuffer.writeUInt32BE(engineTime);
  engineBootsBuffer.copy(iv, 0, 0, 4);
  engineTimeBuffer.copy(iv, 4, 0, 4);
  salt.copy(iv, 8, 0, 8);
  return iv;
};
Encryption.encryptPduAes = function(scopedPdu, privProtocol, privPassword, authProtocol, engine) {
  var aes = Encryption.algorithms[privProtocol];
  var localizationAlgorithm = aes.localizationAlgorithm;
  var encryptionKey;
  var salt;
  var iv;
  var cipher;
  var encryptedPdu;
  encryptionKey = localizationAlgorithm(aes, authProtocol, privPassword, engine.engineID);
  salt = Buffer2.alloc(8).fill(crypto.randomBytes(8), 0, 8);
  iv = Encryption.generateIvAes(aes, engine.engineBoots, engine.engineTime, salt);
  cipher = crypto.createCipheriv(aes.CRYPTO_ALGORITHM, encryptionKey, iv);
  encryptedPdu = cipher.update(scopedPdu);
  encryptedPdu = Buffer2.concat([encryptedPdu, cipher.final()]);
  return {
    encryptedPdu,
    msgPrivacyParameters: salt
  };
};
Encryption.decryptPduAes = function(encryptedPdu, privProtocol, privParameters, privPassword, authProtocol, engine) {
  var aes = Encryption.algorithms[privProtocol];
  var localizationAlgorithm = aes.localizationAlgorithm;
  var decryptionKey;
  var iv;
  var decipher;
  var decryptedPdu;
  decryptionKey = localizationAlgorithm(aes, authProtocol, privPassword, engine.engineID);
  iv = Encryption.generateIvAes(aes, engine.engineBoots, engine.engineTime, privParameters);
  decipher = crypto.createDecipheriv(aes.CRYPTO_ALGORITHM, decryptionKey, iv);
  decryptedPdu = decipher.update(encryptedPdu);
  decryptedPdu = Buffer2.concat([decryptedPdu, decipher.final()]);
  return decryptedPdu;
};
Encryption.algorithms = {};
Encryption.algorithms[PrivProtocols.des] = {
  CRYPTO_ALGORITHM: "des-cbc",
  KEY_LENGTH: 8,
  BLOCK_LENGTH: 8,
  encryptPdu: Encryption.encryptPduDes,
  decryptPdu: Encryption.decryptPduDes,
  localizationAlgorithm: Encryption.generateLocalizedKey
};
Encryption.algorithms[PrivProtocols.aes] = {
  CRYPTO_ALGORITHM: "aes-128-cfb",
  KEY_LENGTH: 16,
  BLOCK_LENGTH: 16,
  encryptPdu: Encryption.encryptPduAes,
  decryptPdu: Encryption.decryptPduAes,
  localizationAlgorithm: Encryption.generateLocalizedKey
};
Encryption.algorithms[PrivProtocols.aes256b] = {
  CRYPTO_ALGORITHM: "aes-256-cfb",
  KEY_LENGTH: 32,
  BLOCK_LENGTH: 16,
  encryptPdu: Encryption.encryptPduAes,
  decryptPdu: Encryption.decryptPduAes,
  localizationAlgorithm: Encryption.generateLocalizedKeyBlumenthal
};
Encryption.algorithms[PrivProtocols.aes256r] = {
  CRYPTO_ALGORITHM: "aes-256-cfb",
  KEY_LENGTH: 32,
  BLOCK_LENGTH: 16,
  encryptPdu: Encryption.encryptPduAes,
  decryptPdu: Encryption.decryptPduAes,
  localizationAlgorithm: Encryption.generateLocalizedKeyReeder
};
var Message = function() {};
Message.prototype.getReqId = function() {
  return this.version == Version3 ? this.msgGlobalData.msgID : this.pdu.id;
};
Message.prototype.toBuffer = function() {
  if (this.version == Version3) {
    return this.toBufferV3();
  } else {
    return this.toBufferCommunity();
  }
};
Message.prototype.toBufferCommunity = function() {
  if (this.buffer)
    return this.buffer;
  var writer = new ber.Writer;
  writer.startSequence();
  writeInt32(writer, ObjectType.Integer, this.version);
  writer.writeString(this.community);
  this.pdu.toBuffer(writer);
  writer.endSequence();
  this.buffer = writer.buffer;
  return this.buffer;
};
Message.prototype.toBufferV3 = function() {
  var encryptionResult;
  if (this.buffer)
    return this.buffer;
  var scopedPduWriter = new ber.Writer;
  scopedPduWriter.startSequence();
  var contextEngineID = this.pdu.contextEngineID ? this.pdu.contextEngineID : this.msgSecurityParameters.msgAuthoritativeEngineID;
  if (contextEngineID.length == 0) {
    scopedPduWriter.writeString("");
  } else {
    scopedPduWriter.writeBuffer(contextEngineID, ber.OctetString);
  }
  scopedPduWriter.writeString(this.pdu.contextName);
  this.pdu.toBuffer(scopedPduWriter);
  scopedPduWriter.endSequence();
  if (this.hasPrivacy()) {
    var authoritativeEngine = {
      engineID: this.msgSecurityParameters.msgAuthoritativeEngineID,
      engineBoots: this.msgSecurityParameters.msgAuthoritativeEngineBoots,
      engineTime: this.msgSecurityParameters.msgAuthoritativeEngineTime
    };
    encryptionResult = Encryption.encryptPdu(this.user.privProtocol, scopedPduWriter.buffer, this.user.privKey, this.user.authProtocol, authoritativeEngine);
  }
  var writer = new ber.Writer;
  writer.startSequence();
  writeInt32(writer, ObjectType.Integer, this.version);
  writer.startSequence();
  writeInt32(writer, ObjectType.Integer, this.msgGlobalData.msgID);
  writeInt32(writer, ObjectType.Integer, this.msgGlobalData.msgMaxSize);
  writer.writeByte(ber.OctetString);
  writer.writeByte(1);
  writer.writeByte(this.msgGlobalData.msgFlags);
  writeInt32(writer, ObjectType.Integer, this.msgGlobalData.msgSecurityModel);
  writer.endSequence();
  writer.startSequence(ber.OctetString);
  writer.startSequence();
  if (this.msgSecurityParameters.msgAuthoritativeEngineID.length == 0) {
    writer.writeString("");
  } else {
    writer.writeBuffer(this.msgSecurityParameters.msgAuthoritativeEngineID, ber.OctetString);
  }
  writeInt32(writer, ObjectType.Integer, this.msgSecurityParameters.msgAuthoritativeEngineBoots);
  writeInt32(writer, ObjectType.Integer, this.msgSecurityParameters.msgAuthoritativeEngineTime);
  writer.writeString(this.msgSecurityParameters.msgUserName);
  var msgAuthenticationParameters = "";
  if (this.hasAuthentication()) {
    var authParametersLength = Authentication.getParametersLength(this.user.authProtocol);
    msgAuthenticationParameters = Buffer2.alloc(authParametersLength);
    writer.writeBuffer(msgAuthenticationParameters, ber.OctetString);
  } else {
    writer.writeString("");
  }
  var msgAuthenticationParametersOffset = writer._offset - msgAuthenticationParameters.length;
  if (this.hasPrivacy()) {
    writer.writeBuffer(encryptionResult.msgPrivacyParameters, ber.OctetString);
  } else {
    writer.writeString("");
  }
  msgAuthenticationParametersOffset -= writer._offset;
  writer.endSequence();
  writer.endSequence();
  msgAuthenticationParametersOffset += writer._offset;
  if (this.hasPrivacy()) {
    writer.writeBuffer(encryptionResult.encryptedPdu, ber.OctetString);
  } else {
    writer.writeBuffer(scopedPduWriter.buffer);
  }
  msgAuthenticationParametersOffset -= writer._offset;
  writer.endSequence();
  msgAuthenticationParametersOffset += writer._offset;
  this.buffer = writer.buffer;
  if (this.hasAuthentication()) {
    msgAuthenticationParameters = this.buffer.subarray(msgAuthenticationParametersOffset, msgAuthenticationParametersOffset + msgAuthenticationParameters.length);
    Authentication.writeParameters(this.buffer, this.user.authProtocol, this.user.authKey, this.msgSecurityParameters.msgAuthoritativeEngineID, msgAuthenticationParameters);
  }
  return this.buffer;
};
Message.prototype.processIncomingSecurity = function(user, responseCb) {
  if (this.hasPrivacy()) {
    if (!this.decryptPdu(user, responseCb)) {
      return false;
    }
  }
  if (this.hasAuthentication() && !this.isAuthenticationDisabled()) {
    return this.checkAuthentication(user, responseCb);
  } else {
    return true;
  }
};
Message.prototype.decryptPdu = function(user, responseCb) {
  var decryptedPdu;
  var decryptedPduReader;
  try {
    var authoratitiveEngine = {
      engineID: this.msgSecurityParameters.msgAuthoritativeEngineID,
      engineBoots: this.msgSecurityParameters.msgAuthoritativeEngineBoots,
      engineTime: this.msgSecurityParameters.msgAuthoritativeEngineTime
    };
    decryptedPdu = Encryption.decryptPdu(user.privProtocol, this.encryptedPdu, this.msgSecurityParameters.msgPrivacyParameters, user.privKey, user.authProtocol, authoratitiveEngine);
    decryptedPduReader = new ber.Reader(decryptedPdu);
    this.pdu = readPdu(decryptedPduReader, true);
    return true;
  } catch (error) {
    responseCb(new ResponseInvalidError("Failed to decrypt PDU: " + error, ResponseInvalidCode.ECouldNotDecrypt));
    return false;
  }
};
Message.prototype.checkAuthentication = function(user, responseCb) {
  if (Authentication.isAuthentic(this.buffer, user.authProtocol, user.authKey, this.msgSecurityParameters.msgAuthoritativeEngineID, this.msgSecurityParameters.msgAuthenticationParameters)) {
    return true;
  } else {
    responseCb(new ResponseInvalidError("Authentication digest " + this.msgSecurityParameters.msgAuthenticationParameters.toString("hex") + " received in message does not match digest " + Authentication.calculateDigest(this.buffer, user.authProtocol, user.authKey, this.msgSecurityParameters.msgAuthoritativeEngineID).toString("hex") + " calculated for message", ResponseInvalidCode.EAuthFailure, { user }));
    return false;
  }
};
Message.prototype.setMsgFlags = function(bitPosition, flag) {
  if (this.msgGlobalData && this.msgGlobalData !== undefined && this.msgGlobalData !== null) {
    if (flag) {
      this.msgGlobalData.msgFlags = this.msgGlobalData.msgFlags | 2 ** bitPosition;
    } else {
      this.msgGlobalData.msgFlags = this.msgGlobalData.msgFlags & 255 - 2 ** bitPosition;
    }
  }
};
Message.prototype.hasAuthentication = function() {
  return this.msgGlobalData && this.msgGlobalData.msgFlags && this.msgGlobalData.msgFlags & 1;
};
Message.prototype.setAuthentication = function(flag) {
  this.setMsgFlags(0, flag);
};
Message.prototype.hasPrivacy = function() {
  return this.msgGlobalData && this.msgGlobalData.msgFlags && this.msgGlobalData.msgFlags & 2;
};
Message.prototype.setPrivacy = function(flag) {
  this.setMsgFlags(1, flag);
};
Message.prototype.isReportable = function() {
  return this.msgGlobalData && this.msgGlobalData.msgFlags && this.msgGlobalData.msgFlags & 4;
};
Message.prototype.setReportable = function(flag) {
  this.setMsgFlags(2, flag);
};
Message.prototype.isAuthenticationDisabled = function() {
  return this.disableAuthentication;
};
Message.prototype.hasAuthoritativeEngineID = function() {
  return this.msgSecurityParameters && this.msgSecurityParameters.msgAuthoritativeEngineID && this.msgSecurityParameters.msgAuthoritativeEngineID != "";
};
Message.prototype.createReportResponseMessage = function(engine, context, errorType) {
  var user = {
    name: "",
    level: SecurityLevel.noAuthNoPriv
  };
  var responseSecurityParameters = {
    msgAuthoritativeEngineID: engine.engineID,
    msgAuthoritativeEngineBoots: engine.engineBoots,
    msgAuthoritativeEngineTime: engine.engineTime,
    msgUserName: user.name,
    msgAuthenticationParameters: "",
    msgPrivacyParameters: ""
  };
  var varbinds = [];
  if (errorType && UsmStats[errorType]) {
    varbinds.push({
      oid: UsmStatsBase + "." + errorType + ".0",
      type: ObjectType.Counter32,
      value: 1
    });
  }
  var reportPdu = ReportPdu.createFromVariables(this.pdu.id, varbinds, {});
  reportPdu.contextName = context;
  var responseMessage = Message.createRequestV3(user, responseSecurityParameters, reportPdu);
  responseMessage.msgGlobalData.msgID = this.msgGlobalData.msgID;
  return responseMessage;
};
Message.prototype.createResponseForRequest = function(responsePdu) {
  if (this.version == Version3) {
    return this.createV3ResponseFromRequest(responsePdu);
  } else {
    return this.createCommunityResponseFromRequest(responsePdu);
  }
};
Message.prototype.createCommunityResponseFromRequest = function(responsePdu) {
  return Message.createCommunity(this.version, this.community, responsePdu);
};
Message.prototype.createV3ResponseFromRequest = function(responsePdu) {
  var responseUser = {
    name: this.user.name,
    level: this.user.level,
    authProtocol: this.user.authProtocol,
    authKey: this.user.authKey,
    privProtocol: this.user.privProtocol,
    privKey: this.user.privKey
  };
  var responseSecurityParameters = {
    msgAuthoritativeEngineID: this.msgSecurityParameters.msgAuthoritativeEngineID,
    msgAuthoritativeEngineBoots: this.msgSecurityParameters.msgAuthoritativeEngineBoots,
    msgAuthoritativeEngineTime: this.msgSecurityParameters.msgAuthoritativeEngineTime,
    msgUserName: this.msgSecurityParameters.msgUserName,
    msgAuthenticationParameters: "",
    msgPrivacyParameters: ""
  };
  var responseGlobalData = {
    msgID: this.msgGlobalData.msgID,
    msgMaxSize: 65507,
    msgFlags: this.msgGlobalData.msgFlags & 255 - 4,
    msgSecurityModel: 3
  };
  return Message.createV3(responseUser, responseGlobalData, responseSecurityParameters, responsePdu);
};
Message.createCommunity = function(version, community, pdu) {
  var message = new Message;
  message.version = version;
  message.community = community;
  message.pdu = pdu;
  return message;
};
Message.createRequestV3 = function(user, msgSecurityParameters, pdu) {
  var authFlag = user.level == SecurityLevel.authNoPriv || user.level == SecurityLevel.authPriv ? 1 : 0;
  var privFlag = user.level == SecurityLevel.authPriv ? 1 : 0;
  var reportableFlag = pdu.type == PduType.GetResponse || pdu.type == PduType.TrapV2 ? 0 : 1;
  var msgGlobalData = {
    msgID: _generateId(),
    msgMaxSize: 65507,
    msgFlags: reportableFlag * 4 | privFlag * 2 | authFlag * 1,
    msgSecurityModel: 3
  };
  return Message.createV3(user, msgGlobalData, msgSecurityParameters, pdu);
};
Message.createV3 = function(user, msgGlobalData, msgSecurityParameters, pdu) {
  var message = new Message;
  message.version = 3;
  message.user = user;
  message.msgGlobalData = msgGlobalData;
  message.msgSecurityParameters = {
    msgAuthoritativeEngineID: msgSecurityParameters.msgAuthoritativeEngineID || Buffer2.from(""),
    msgAuthoritativeEngineBoots: msgSecurityParameters.msgAuthoritativeEngineBoots || 0,
    msgAuthoritativeEngineTime: msgSecurityParameters.msgAuthoritativeEngineTime || 0,
    msgUserName: user.name || "",
    msgAuthenticationParameters: "",
    msgPrivacyParameters: ""
  };
  message.pdu = pdu;
  return message;
};
Message.createDiscoveryV3 = function(pdu) {
  var msgSecurityParameters = {
    msgAuthoritativeEngineID: Buffer2.from(""),
    msgAuthoritativeEngineBoots: 0,
    msgAuthoritativeEngineTime: 0
  };
  var emptyUser = {
    name: "",
    level: SecurityLevel.noAuthNoPriv
  };
  return Message.createRequestV3(emptyUser, msgSecurityParameters, pdu);
};
Message.createFromBuffer = function(buffer, user) {
  var reader = new ber.Reader(buffer);
  var message = new Message;
  reader.readSequence();
  message.version = readInt32(reader);
  if (message.version != 3) {
    message.community = reader.readString();
    message.pdu = readPdu(reader, false);
  } else {
    message.msgGlobalData = {};
    reader.readSequence();
    message.msgGlobalData.msgID = readInt32(reader);
    message.msgGlobalData.msgMaxSize = readInt32(reader);
    message.msgGlobalData.msgFlags = reader.readString(ber.OctetString, true)[0];
    message.msgGlobalData.msgSecurityModel = readInt32(reader);
    message.msgSecurityParameters = {};
    var msgSecurityParametersReader = new ber.Reader(reader.readString(ber.OctetString, true));
    msgSecurityParametersReader.readSequence();
    message.msgSecurityParameters.msgAuthoritativeEngineID = msgSecurityParametersReader.readString(ber.OctetString, true);
    message.msgSecurityParameters.msgAuthoritativeEngineBoots = readInt32(msgSecurityParametersReader);
    message.msgSecurityParameters.msgAuthoritativeEngineTime = readInt32(msgSecurityParametersReader);
    message.msgSecurityParameters.msgUserName = msgSecurityParametersReader.readString();
    message.msgSecurityParameters.msgAuthenticationParameters = msgSecurityParametersReader.readString(ber.OctetString, true);
    message.msgSecurityParameters.msgPrivacyParameters = Buffer2.from(msgSecurityParametersReader.readString(ber.OctetString, true));
    if (message.hasPrivacy()) {
      message.encryptedPdu = reader.readString(ber.OctetString, true);
      message.pdu = null;
    } else {
      message.pdu = readPdu(reader, true);
    }
  }
  message.buffer = buffer;
  return message;
};
var Req = function(session, message, feedCb, responseCb, options) {
  this.message = message;
  this.responseCb = responseCb;
  this.retries = session.retries;
  this.timeout = session.timeout;
  this.backoff = session.backoff;
  this.onResponse = session.onSimpleGetResponse;
  this.feedCb = feedCb;
  this.port = options && options.port ? options.port : session.port;
  this.context = session.context;
};
Req.prototype.getId = function() {
  return this.message.getReqId();
};
var Session = function(target, authenticator, options) {
  this.target = target || "127.0.0.1";
  options = options || {};
  this.version = options.version ? options.version : Version1;
  if (this.version == Version3) {
    this.user = authenticator;
  } else {
    this.community = authenticator || "public";
  }
  this.transport = options.transport ? options.transport : "udp4";
  this.port = options.port ? options.port : 161;
  this.trapPort = options.trapPort ? options.trapPort : 162;
  this.retries = options.retries || options.retries == 0 ? options.retries : 1;
  this.timeout = options.timeout ? options.timeout : 5000;
  this.backoff = options.backoff >= 1 ? options.backoff : 1;
  this.sourceAddress = options.sourceAddress ? options.sourceAddress : undefined;
  this.sourcePort = options.sourcePort ? parseInt(options.sourcePort) : undefined;
  this.idBitsSize = options.idBitsSize ? parseInt(options.idBitsSize) : 32;
  this.context = options.context ? options.context : "";
  this.backwardsGetNexts = typeof options.backwardsGetNexts !== "undefined" ? options.backwardsGetNexts : true;
  this.reportOidMismatchErrors = typeof options.reportOidMismatchErrors !== "undefined" ? options.reportOidMismatchErrors : false;
  DEBUG |= options.debug;
  this.engine = new Engine({
    engineID: options.engineID
  });
  this.reqs = {};
  this.reqCount = 0;
  const dgramMod = options.dgramModule || dgram;
  this.dgram = dgramMod.createSocket(this.transport);
  this.dgram.unref();
  var me = this;
  this.dgram.on("message", me.onMsg.bind(me));
  this.dgram.on("close", me.onClose.bind(me));
  this.dgram.on("error", me.onError.bind(me));
  if (this.sourceAddress || this.sourcePort)
    this.dgram.bind(this.sourcePort, this.sourceAddress);
};
util.inherits(Session, events.EventEmitter);
Session.prototype.close = function() {
  this.dgram.close();
  return this;
};
Session.prototype.cancelRequests = function(error) {
  var id;
  for (id in this.reqs) {
    var req = this.reqs[id];
    this.unregisterRequest(req.getId());
    req.responseCb(error);
  }
};
function _generateId(bitSize) {
  if (bitSize === 16) {
    return Math.floor(Math.random() * 1e4) % 65535;
  }
  return Math.floor(Math.random() * 1e8) % 4294967295;
}
Session.prototype.get = function(oids, responseCb) {
  var reportOidMismatchErrors = this.reportOidMismatchErrors;
  function feedCb(req, message) {
    var pdu = message.pdu;
    var varbinds = [];
    if (req.message.pdu.varbinds.length != pdu.varbinds.length) {
      req.responseCb(new ResponseInvalidError("Requested OIDs do not " + "match response OIDs", ResponseInvalidCode.EReqResOidNoMatch));
    } else {
      for (var i2 = 0;i2 < req.message.pdu.varbinds.length; i2++) {
        if (reportOidMismatchErrors && req.message.pdu.varbinds[i2].oid != pdu.varbinds[i2].oid) {
          req.responseCb(new ResponseInvalidError("OID '" + req.message.pdu.varbinds[i2].oid + "' in request at position '" + i2 + "' does not " + "match OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.EReqResOidNoMatch));
          return;
        } else {
          varbinds.push(pdu.varbinds[i2]);
        }
      }
      req.responseCb(null, varbinds);
    }
  }
  var pduVarbinds = [];
  for (var i = 0;i < oids.length; i++) {
    var varbind = {
      oid: oids[i]
    };
    pduVarbinds.push(varbind);
  }
  this.simpleGet(GetRequestPdu, feedCb, pduVarbinds, responseCb);
  return this;
};
Session.prototype.getBulk = function() {
  var oids, nonRepeaters, maxRepetitions, responseCb;
  var reportOidMismatchErrors = this.reportOidMismatchErrors;
  var backwardsGetNexts = this.backwardsGetNexts;
  if (arguments.length >= 4) {
    oids = arguments[0];
    nonRepeaters = arguments[1];
    maxRepetitions = arguments[2];
    responseCb = arguments[3];
  } else if (arguments.length >= 3) {
    oids = arguments[0];
    nonRepeaters = arguments[1];
    maxRepetitions = 10;
    responseCb = arguments[2];
  } else {
    oids = arguments[0];
    nonRepeaters = 0;
    maxRepetitions = 10;
    responseCb = arguments[1];
  }
  function feedCb(req, message) {
    var pdu = message.pdu;
    var reqVarbinds = req.message.pdu.varbinds;
    var varbinds = [];
    var i2 = 0;
    for (;i2 < reqVarbinds.length && i2 < pdu.varbinds.length; i2++) {
      if (isVarbindError(pdu.varbinds[i2])) {
        if (reportOidMismatchErrors && reqVarbinds[i2].oid != pdu.varbinds[i2].oid) {
          req.responseCb(new ResponseInvalidError("OID '" + reqVarbinds[i2].oid + "' in request at position '" + i2 + "' does not " + "match OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.EReqResOidNoMatch));
          return;
        }
      } else {
        if (!backwardsGetNexts && !oidFollowsOid(reqVarbinds[i2].oid, pdu.varbinds[i2].oid)) {
          req.responseCb(new ResponseInvalidError("OID '" + reqVarbinds[i2].oid + "' in request at positiion '" + i2 + "' does not " + "precede OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.EOutOfOrder));
          return;
        }
      }
      if (i2 < nonRepeaters)
        varbinds.push(pdu.varbinds[i2]);
      else
        varbinds.push([pdu.varbinds[i2]]);
    }
    var repeaters = reqVarbinds.length - nonRepeaters;
    for (;i2 < pdu.varbinds.length; i2++) {
      var reqIndex = (i2 - nonRepeaters) % repeaters + nonRepeaters;
      var prevIndex = i2 - repeaters;
      var prevOid = pdu.varbinds[prevIndex].oid;
      if (isVarbindError(pdu.varbinds[i2])) {
        if (reportOidMismatchErrors && prevOid != pdu.varbinds[i2].oid) {
          req.responseCb(new ResponseInvalidError("OID '" + prevOid + "' in response at position '" + prevIndex + "' does not " + "match OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.EReqResOidNoMatch));
          return;
        }
      } else {
        if (!backwardsGetNexts && !oidFollowsOid(prevOid, pdu.varbinds[i2].oid)) {
          req.responseCb(new ResponseInvalidError("OID '" + prevOid + "' in response at positiion '" + prevIndex + "' does not " + "precede OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.EOutOfOrder));
          return;
        }
      }
      varbinds[reqIndex].push(pdu.varbinds[i2]);
    }
    req.responseCb(null, varbinds);
  }
  var pduVarbinds = [];
  for (var i = 0;i < oids.length; i++) {
    var varbind = {
      oid: oids[i]
    };
    pduVarbinds.push(varbind);
  }
  var options = {
    nonRepeaters,
    maxRepetitions
  };
  this.simpleGet(GetBulkRequestPdu, feedCb, pduVarbinds, responseCb, options);
  return this;
};
Session.prototype.getNext = function(oids, responseCb) {
  var backwardsGetNexts = this.backwardsGetNexts;
  function feedCb(req, message) {
    var pdu = message.pdu;
    var varbinds = [];
    if (req.message.pdu.varbinds.length != pdu.varbinds.length) {
      req.responseCb(new ResponseInvalidError("Requested OIDs do not " + "match response OIDs", ResponseInvalidCode.EReqResOidNoMatch));
    } else {
      for (var i2 = 0;i2 < req.message.pdu.varbinds.length; i2++) {
        if (isVarbindError(pdu.varbinds[i2])) {
          varbinds.push(pdu.varbinds[i2]);
        } else if (!backwardsGetNexts && !oidFollowsOid(req.message.pdu.varbinds[i2].oid, pdu.varbinds[i2].oid)) {
          req.responseCb(new ResponseInvalidError("OID '" + req.message.pdu.varbinds[i2].oid + "' in request at " + "positiion '" + i2 + "' does not precede " + "OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.OutOfOrder));
          return;
        } else {
          varbinds.push(pdu.varbinds[i2]);
        }
      }
      req.responseCb(null, varbinds);
    }
  }
  var pduVarbinds = [];
  for (var i = 0;i < oids.length; i++) {
    var varbind = {
      oid: oids[i]
    };
    pduVarbinds.push(varbind);
  }
  this.simpleGet(GetNextRequestPdu, feedCb, pduVarbinds, responseCb);
  return this;
};
Session.prototype.inform = function() {
  var typeOrOid = arguments[0];
  var varbinds, options = {}, responseCb;
  if (arguments.length >= 4) {
    varbinds = arguments[1];
    options = arguments[2];
    responseCb = arguments[3];
  } else if (arguments.length >= 3) {
    if (arguments[1].constructor != Array) {
      varbinds = [];
      options = arguments[1];
      responseCb = arguments[2];
    } else {
      varbinds = arguments[1];
      responseCb = arguments[2];
    }
  } else {
    varbinds = [];
    responseCb = arguments[1];
  }
  if (this.version == Version1) {
    responseCb(new RequestInvalidError("Inform not allowed for SNMPv1"));
    return;
  }
  function feedCb(req, message) {
    var pdu = message.pdu;
    var varbinds2 = [];
    if (req.message.pdu.varbinds.length != pdu.varbinds.length) {
      req.responseCb(new ResponseInvalidError("Inform OIDs do not " + "match response OIDs", ResponseInvalidCode.EReqResOidNoMatch));
    } else {
      for (var i2 = 0;i2 < req.message.pdu.varbinds.length; i2++) {
        if (req.message.pdu.varbinds[i2].oid != pdu.varbinds[i2].oid) {
          req.responseCb(new ResponseInvalidError("OID '" + req.message.pdu.varbinds[i2].oid + "' in inform at positiion '" + i2 + "' does not " + "match OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.EReqResOidNoMatch));
          return;
        } else {
          varbinds2.push(pdu.varbinds[i2]);
        }
      }
      req.responseCb(null, varbinds2);
    }
  }
  if (typeof typeOrOid != "string")
    typeOrOid = "1.3.6.1.6.3.1.1.5." + (typeOrOid + 1);
  var pduVarbinds = [
    {
      oid: "1.3.6.1.2.1.1.3.0",
      type: ObjectType.TimeTicks,
      value: options.upTime || Math.floor(process.uptime() * 100)
    },
    {
      oid: "1.3.6.1.6.3.1.1.4.1.0",
      type: ObjectType.OID,
      value: typeOrOid
    }
  ];
  for (var i = 0;i < varbinds.length; i++) {
    var varbind = {
      oid: varbinds[i].oid,
      type: varbinds[i].type,
      value: varbinds[i].value
    };
    pduVarbinds.push(varbind);
  }
  options.port = this.trapPort;
  this.simpleGet(InformRequestPdu, feedCb, pduVarbinds, responseCb, options);
  return this;
};
Session.prototype.onClose = function() {
  this.cancelRequests(new Error("Socket forcibly closed"));
  this.emit("close");
};
Session.prototype.onError = function(error) {
  this.emit(error);
};
Session.prototype.onMsg = function(buffer) {
  try {
    var message = Message.createFromBuffer(buffer);
  } catch (error) {
    this.emit("error", error);
    return;
  }
  var req = this.unregisterRequest(message.getReqId());
  if (!req)
    return;
  if (!message.processIncomingSecurity(this.user, req.responseCb))
    return;
  if (message.version != req.message.version) {
    req.responseCb(new ResponseInvalidError("Version in request '" + req.message.version + "' does not match version in " + "response '" + message.version + "'", ResponseInvalidCode.EVersionNoMatch));
  } else if (message.community != req.message.community) {
    req.responseCb(new ResponseInvalidError("Community '" + req.message.community + "' in request does not match " + "community '" + message.community + "' in response", ResponseInvalidCode.ECommunityNoMatch));
  } else if (message.pdu.type == PduType.Report) {
    this.msgSecurityParameters = {
      msgAuthoritativeEngineID: message.msgSecurityParameters.msgAuthoritativeEngineID,
      msgAuthoritativeEngineBoots: message.msgSecurityParameters.msgAuthoritativeEngineBoots,
      msgAuthoritativeEngineTime: message.msgSecurityParameters.msgAuthoritativeEngineTime
    };
    if (this.proxy) {
      this.msgSecurityParameters.msgUserName = this.proxy.user.name;
      this.msgSecurityParameters.msgAuthenticationParameters = "";
      this.msgSecurityParameters.msgPrivacyParameters = "";
    } else {
      if (!req.originalPdu || !req.allowReport) {
        if (Array.isArray(message.pdu.varbinds) && message.pdu.varbinds[0] && message.pdu.varbinds[0].oid.indexOf(UsmStatsBase) === 0) {
          this.userSecurityModelError(req, message.pdu.varbinds[0].oid);
          return;
        }
        req.responseCb(new ResponseInvalidError("Unexpected Report PDU", ResponseInvalidCode.EUnexpectedReport));
        return;
      }
      req.originalPdu.contextName = this.context;
      var timeSyncNeeded = !message.msgSecurityParameters.msgAuthoritativeEngineBoots && !message.msgSecurityParameters.msgAuthoritativeEngineTime;
      this.sendV3Req(req.originalPdu, req.feedCb, req.responseCb, req.options, req.port, timeSyncNeeded);
    }
  } else if (this.proxy) {
    this.onProxyResponse(req, message);
  } else if (message.pdu.type == PduType.GetResponse) {
    req.onResponse(req, message);
  } else {
    req.responseCb(new ResponseInvalidError("Unknown PDU type '" + message.pdu.type + "' in response", ResponseInvalidCode.EUnknownPduType));
  }
};
Session.prototype.onSimpleGetResponse = function(req, message) {
  var pdu = message.pdu;
  if (pdu.errorStatus > 0) {
    var statusString = ErrorStatus[pdu.errorStatus] || ErrorStatus.GeneralError;
    var statusCode = ErrorStatus[statusString] || ErrorStatus[ErrorStatus.GeneralError];
    if (pdu.errorIndex <= 0 || pdu.errorIndex > pdu.varbinds.length) {
      req.responseCb(new RequestFailedError(statusString, statusCode));
    } else {
      var oid = pdu.varbinds[pdu.errorIndex - 1].oid;
      var error = new RequestFailedError(statusString + ": " + oid, statusCode);
      req.responseCb(error);
    }
  } else {
    req.feedCb(req, message);
  }
};
Session.prototype.registerRequest = function(req) {
  if (!this.reqs[req.getId()]) {
    this.reqs[req.getId()] = req;
    if (this.reqCount <= 0)
      this.dgram.ref();
    this.reqCount++;
  }
  var me = this;
  req.timer = setTimeout(function() {
    if (req.retries-- > 0) {
      me.send(req);
    } else {
      me.unregisterRequest(req.getId());
      req.responseCb(new RequestTimedOutError("Request timed out"));
    }
  }, req.timeout);
  if (req.backoff && req.backoff >= 1)
    req.timeout *= req.backoff;
};
Session.prototype.send = function(req, noWait) {
  try {
    var me = this;
    var buffer = req.message.toBuffer();
    this.dgram.send(buffer, 0, buffer.length, req.port, this.target, function(error, bytes) {
      if (error) {
        req.responseCb(error);
      } else {
        if (noWait) {
          req.responseCb(null);
        } else {
          me.registerRequest(req);
        }
      }
    });
  } catch (error) {
    req.responseCb(error);
  }
  return this;
};
Session.prototype.set = function(varbinds, responseCb) {
  var reportOidMismatchErrors = this.reportOidMismatchErrors;
  function feedCb(req, message) {
    var pdu = message.pdu;
    var varbinds2 = [];
    if (req.message.pdu.varbinds.length != pdu.varbinds.length) {
      req.responseCb(new ResponseInvalidError("Requested OIDs do not " + "match response OIDs", ResponseInvalidCode.EReqResOidNoMatch));
    } else {
      for (var i2 = 0;i2 < req.message.pdu.varbinds.length; i2++) {
        if (reportOidMismatchErrors && req.message.pdu.varbinds[i2].oid != pdu.varbinds[i2].oid) {
          req.responseCb(new ResponseInvalidError("OID '" + req.message.pdu.varbinds[i2].oid + "' in request at position '" + i2 + "' does not " + "match OID '" + pdu.varbinds[i2].oid + "' in response " + "at position '" + i2 + "'", ResponseInvalidCode.EReqResOidNoMatch));
          return;
        } else {
          varbinds2.push(pdu.varbinds[i2]);
        }
      }
      req.responseCb(null, varbinds2);
    }
  }
  var pduVarbinds = [];
  for (var i = 0;i < varbinds.length; i++) {
    var varbind = {
      oid: varbinds[i].oid,
      type: varbinds[i].type,
      value: varbinds[i].value
    };
    pduVarbinds.push(varbind);
  }
  this.simpleGet(SetRequestPdu, feedCb, pduVarbinds, responseCb);
  return this;
};
Session.prototype.simpleGet = function(pduClass, feedCb, varbinds, responseCb, options) {
  var id = _generateId(this.idBitsSize);
  options = Object.assign({}, options, { context: this.context });
  var pdu = SimplePdu.createFromVariables(pduClass, id, varbinds, options);
  var message;
  var req;
  if (this.version == Version3) {
    if (this.msgSecurityParameters) {
      this.sendV3Req(pdu, feedCb, responseCb, options, this.port, true);
    } else {
      this.sendV3Discovery(pdu, feedCb, responseCb, options);
    }
  } else {
    message = Message.createCommunity(this.version, this.community, pdu);
    req = new Req(this, message, feedCb, responseCb, options);
    this.send(req);
  }
};
function subtreeCb(req, varbinds) {
  var done = 0;
  for (var i = varbinds.length;i > 0; i--) {
    if (!oidInSubtree(req.baseOid, varbinds[i - 1].oid)) {
      done = 1;
      varbinds.pop();
    }
  }
  if (varbinds.length > 0) {
    if (req.feedCb(varbinds)) {
      done = 1;
    }
  }
  if (done)
    return true;
}
Session.prototype.subtree = function() {
  var me = this;
  var oid = arguments[0];
  var maxRepetitions, feedCb, doneCb;
  if (arguments.length < 4) {
    maxRepetitions = 20;
    feedCb = arguments[1];
    doneCb = arguments[2];
  } else {
    maxRepetitions = arguments[1];
    feedCb = arguments[2];
    doneCb = arguments[3];
  }
  var req = {
    feedCb,
    doneCb,
    maxRepetitions,
    baseOid: oid
  };
  this.walk(oid, maxRepetitions, subtreeCb.bind(me, req), doneCb);
  return this;
};
function tableColumnsResponseCb(req, error) {
  if (error) {
    req.responseCb(error);
  } else if (req.error) {
    req.responseCb(req.error);
  } else {
    if (req.columns.length > 0) {
      var column = req.columns.pop();
      var me = this;
      this.subtree(req.rowOid + column, req.maxRepetitions, tableColumnsFeedCb.bind(me, req), tableColumnsResponseCb.bind(me, req));
    } else {
      req.responseCb(null, req.table);
    }
  }
}
function tableColumnsFeedCb(req, varbinds) {
  for (var i = 0;i < varbinds.length; i++) {
    if (isVarbindError(varbinds[i])) {
      req.error = new RequestFailedError(varbindError(varbinds[i]));
      return true;
    }
    var oid = varbinds[i].oid.replace(req.rowOid, "");
    if (oid && oid != varbinds[i].oid) {
      var match = oid.match(/^(\d+)\.(.+)$/);
      if (match && match[1] > 0) {
        if (!req.table[match[2]])
          req.table[match[2]] = {};
        req.table[match[2]][match[1]] = varbinds[i].value;
      }
    }
  }
}
Session.prototype.tableColumns = function() {
  var me = this;
  var oid = arguments[0];
  var columns = arguments[1];
  var maxRepetitions, responseCb;
  if (arguments.length < 4) {
    responseCb = arguments[2];
    maxRepetitions = 20;
  } else {
    maxRepetitions = arguments[2];
    responseCb = arguments[3];
  }
  var req = {
    responseCb,
    maxRepetitions,
    baseOid: oid,
    rowOid: oid + ".1.",
    columns: columns.slice(0),
    table: {}
  };
  if (req.columns.length > 0) {
    var column = req.columns.pop();
    this.subtree(req.rowOid + column, maxRepetitions, tableColumnsFeedCb.bind(me, req), tableColumnsResponseCb.bind(me, req));
  }
  return this;
};
function tableResponseCb(req, error) {
  if (error)
    req.responseCb(error);
  else if (req.error)
    req.responseCb(req.error);
  else
    req.responseCb(null, req.table);
}
function tableFeedCb(req, varbinds) {
  for (var i = 0;i < varbinds.length; i++) {
    if (isVarbindError(varbinds[i])) {
      req.error = new RequestFailedError(varbindError(varbinds[i]));
      return true;
    }
    var oid = varbinds[i].oid.replace(req.rowOid, "");
    if (oid && oid != varbinds[i].oid) {
      var match = oid.match(/^(\d+)\.(.+)$/);
      if (match && match[1] > 0) {
        if (!req.table[match[2]])
          req.table[match[2]] = {};
        req.table[match[2]][match[1]] = varbinds[i].value;
      }
    }
  }
}
Session.prototype.table = function() {
  var me = this;
  var oid = arguments[0];
  var maxRepetitions, responseCb;
  if (arguments.length < 3) {
    responseCb = arguments[1];
    maxRepetitions = 20;
  } else {
    maxRepetitions = arguments[1];
    responseCb = arguments[2];
  }
  var req = {
    responseCb,
    maxRepetitions,
    baseOid: oid,
    rowOid: oid + ".1.",
    table: {}
  };
  this.subtree(oid, maxRepetitions, tableFeedCb.bind(me, req), tableResponseCb.bind(me, req));
  return this;
};
Session.prototype.trap = function() {
  var req = {};
  var typeOrOid = arguments[0];
  var varbinds, options = {}, responseCb;
  var message;
  if (arguments.length >= 4) {
    varbinds = arguments[1];
    if (typeof arguments[2] == "string") {
      options.agentAddr = arguments[2];
    } else if (arguments[2].constructor != Array) {
      options = arguments[2];
    }
    responseCb = arguments[3];
  } else if (arguments.length >= 3) {
    if (typeof arguments[1] == "string") {
      varbinds = [];
      options.agentAddr = arguments[1];
    } else if (arguments[1].constructor != Array) {
      varbinds = [];
      options = arguments[1];
    } else {
      varbinds = arguments[1];
      options.agentAddr = null;
    }
    responseCb = arguments[2];
  } else {
    varbinds = [];
    responseCb = arguments[1];
  }
  var pdu, pduVarbinds = [];
  for (var i = 0;i < varbinds.length; i++) {
    var varbind = {
      oid: varbinds[i].oid,
      type: varbinds[i].type,
      value: varbinds[i].value
    };
    pduVarbinds.push(varbind);
  }
  var id = _generateId(this.idBitsSize);
  if (this.version == Version2c || this.version == Version3) {
    if (typeof typeOrOid != "string")
      typeOrOid = "1.3.6.1.6.3.1.1.5." + (typeOrOid + 1);
    pduVarbinds.unshift({
      oid: "1.3.6.1.2.1.1.3.0",
      type: ObjectType.TimeTicks,
      value: options.upTime || Math.floor(process.uptime() * 100)
    }, {
      oid: "1.3.6.1.6.3.1.1.4.1.0",
      type: ObjectType.OID,
      value: typeOrOid
    });
    pdu = TrapV2Pdu.createFromVariables(id, pduVarbinds, options);
  } else {
    pdu = TrapPdu.createFromVariables(typeOrOid, pduVarbinds, options);
  }
  if (this.version == Version3) {
    var msgSecurityParameters = {
      msgAuthoritativeEngineID: this.engine.engineID,
      msgAuthoritativeEngineBoots: 0,
      msgAuthoritativeEngineTime: 0
    };
    message = Message.createRequestV3(this.user, msgSecurityParameters, pdu);
  } else {
    message = Message.createCommunity(this.version, this.community, pdu);
  }
  req = {
    id,
    message,
    responseCb,
    port: this.trapPort
  };
  this.send(req, true);
  return this;
};
Session.prototype.unregisterRequest = function(id) {
  var req = this.reqs[id];
  if (req) {
    delete this.reqs[id];
    clearTimeout(req.timer);
    delete req.timer;
    this.reqCount--;
    if (this.reqCount <= 0)
      this.dgram.unref();
    return req;
  } else {
    return null;
  }
};
function walkCb(req, error, varbinds) {
  var done = 0;
  var oid;
  if (error) {
    if (error instanceof RequestFailedError) {
      if (error.status != ErrorStatus.NoSuchName) {
        req.doneCb(error);
        return;
      } else {
        done = 1;
      }
    } else {
      req.doneCb(error);
      return;
    }
  }
  if (!varbinds || !varbinds.length) {
    req.doneCb(null);
    return;
  }
  if (this.version == Version2c || this.version == Version3) {
    for (var i = varbinds[0].length;i > 0; i--) {
      if (varbinds[0][i - 1].type == ObjectType.EndOfMibView) {
        varbinds[0].pop();
        done = 1;
      }
    }
    if (req.feedCb(varbinds[0]))
      done = 1;
    if (!done)
      oid = varbinds[0][varbinds[0].length - 1].oid;
  } else {
    if (varbinds[0].type == ObjectType.EndOfMibView) {
      done = 1;
    }
    if (!done) {
      if (req.feedCb(varbinds)) {
        done = 1;
      } else {
        oid = varbinds[0].oid;
      }
    }
  }
  if (done)
    req.doneCb(null);
  else
    this.walk(oid, req.maxRepetitions, req.feedCb, req.doneCb, req.baseOid);
}
Session.prototype.walk = function() {
  var me = this;
  var oid = arguments[0];
  var maxRepetitions, feedCb, doneCb;
  if (arguments.length < 4) {
    maxRepetitions = 20;
    feedCb = arguments[1];
    doneCb = arguments[2];
  } else {
    maxRepetitions = arguments[1];
    feedCb = arguments[2];
    doneCb = arguments[3];
  }
  var req = {
    maxRepetitions,
    feedCb,
    doneCb
  };
  if (this.version == Version2c || this.version == Version3)
    this.getBulk([oid], 0, maxRepetitions, walkCb.bind(me, req));
  else
    this.getNext([oid], walkCb.bind(me, req));
  return this;
};
Session.prototype.sendV3Req = function(pdu, feedCb, responseCb, options, port, allowReport) {
  var message = Message.createRequestV3(this.user, this.msgSecurityParameters, pdu);
  var reqOptions = options || {};
  var req = new Req(this, message, feedCb, responseCb, reqOptions);
  req.port = port;
  req.originalPdu = pdu;
  req.allowReport = allowReport;
  this.send(req);
};
Session.prototype.sendV3Discovery = function(originalPdu, feedCb, responseCb, options) {
  var discoveryPdu = createDiscoveryPdu(this.context);
  var discoveryMessage = Message.createDiscoveryV3(discoveryPdu);
  var discoveryReq = new Req(this, discoveryMessage, feedCb, responseCb, options);
  discoveryReq.originalPdu = originalPdu;
  discoveryReq.allowReport = true;
  this.send(discoveryReq);
};
Session.prototype.userSecurityModelError = function(req, oid) {
  var oidSuffix = oid.replace(UsmStatsBase + ".", "").replace(/\.0$/, "");
  var errorType = UsmStats[oidSuffix] || "Unexpected Report PDU";
  req.responseCb(new ResponseInvalidError(errorType, ResponseInvalidCode.EAuthFailure));
};
Session.prototype.onProxyResponse = function(req, message) {
  if (message.version != Version3) {
    this.callback(new RequestFailedError("Only SNMP version 3 contexts are supported"));
    return;
  }
  message.pdu.contextName = this.proxy.context;
  message.user = req.proxiedUser;
  message.setAuthentication(!(req.proxiedUser.level == SecurityLevel.noAuthNoPriv));
  message.setPrivacy(req.proxiedUser.level == SecurityLevel.authPriv);
  message.msgSecurityParameters = {
    msgAuthoritativeEngineID: req.proxiedEngine.engineID,
    msgAuthoritativeEngineBoots: req.proxiedEngine.engineBoots,
    msgAuthoritativeEngineTime: req.proxiedEngine.engineTime,
    msgUserName: req.proxiedUser.name,
    msgAuthenticationParameters: "",
    msgPrivacyParameters: ""
  };
  message.buffer = null;
  message.pdu.contextEngineID = message.msgSecurityParameters.msgAuthoritativeEngineID;
  message.pdu.contextName = this.proxy.context;
  message.pdu.id = req.proxiedPduId;
  this.proxy.listener.send(message, req.proxiedRinfo, req.proxiedSocket);
};
Session.create = function(target, community, options) {
  var version = options && options.version ? options.version : Version1;
  if (version != Version1 && version != Version2c) {
    throw new ResponseInvalidError("SNMP community session requested but version '" + options.version + "' specified in options not valid", ResponseInvalidCode.EVersionNoMatch);
  } else {
    if (!options)
      options = {};
    options.version = version;
    return new Session(target, community, options);
  }
};
Session.createV3 = function(target, user, options) {
  if (options && options.version && options.version != Version3) {
    throw new ResponseInvalidError("SNMPv3 session requested but version '" + options.version + "' specified in options", ResponseInvalidCode.EVersionNoMatch);
  } else {
    if (!options)
      options = {};
    options.version = Version3;
  }
  return new Session(target, user, options);
};
var Engine = function(engineOptions) {
  let { engineID } = engineOptions;
  if (engineID) {
    if (!(engineID instanceof Buffer2)) {
      engineID = engineID.replace("0x", "");
      this.engineID = Buffer2.from((engineID.toString().length % 2 == 1 ? "0" : "") + engineID.toString(), "hex");
    } else {
      this.engineID = engineID;
    }
  } else {
    this.generateEngineID();
  }
  this.engineBoots = 0;
  this.engineTime = 10;
};
Engine.prototype.generateEngineID = function() {
  this.engineID = Buffer2.alloc(17);
  this.engineID.fill("8000B98380", "hex", 0, 5);
  this.engineID.fill(crypto.randomBytes(12), 5, 17, "hex");
};
var Listener = function(options, receiver) {
  this.receiver = receiver;
  this.callback = receiver.onMsg;
  this.disableAuthorization = options.disableAuthorization || false;
  this.dgramModule = options.dgramModule || dgram;
  if (options.sockets) {
    this.socketOptions = options.sockets;
  } else {
    this.socketOptions = [
      {
        transport: options.transport,
        address: options.address,
        port: options.port
      }
    ];
  }
  for (const socketOption of this.socketOptions) {
    socketOption.transport = socketOption.transport || "udp4";
    socketOption.address = socketOption.address || null;
    socketOption.port = socketOption.port || 161;
  }
};
Listener.prototype.startListening = function() {
  var me = this;
  this.sockets = {};
  for (const socketOptions of this.socketOptions) {
    const dgramMod = this.dgramModule;
    const socket = dgramMod.createSocket(socketOptions.transport);
    socket.on("error", me.receiver.callback);
    socket.bind(socketOptions.port, socketOptions.address);
    socket.on("message", me.callback.bind(me.receiver, socket));
    const socketKey = socketOptions.transport + ":" + socketOptions.address + ":" + socketOptions.port;
    if (this.sockets[socketKey]) {
      throw new Error("Duplicate socket exists for " + socketKey);
    }
    this.sockets[socketKey] = socket;
  }
};
Listener.prototype.send = function(message, rinfo, socket) {
  var buffer = message.toBuffer();
  socket.send(buffer, 0, buffer.length, rinfo.port, rinfo.address, function(error, bytes) {
    if (error) {
      console.error("Error sending: " + error.message);
    } else {}
  });
};
Listener.formatCallbackData = function(pdu, rinfo) {
  if (pdu.contextEngineID) {
    pdu.contextEngineID = pdu.contextEngineID.toString("hex");
  }
  delete pdu.nonRepeaters;
  delete pdu.maxRepetitions;
  return {
    pdu,
    rinfo
  };
};
Listener.processIncoming = function(buffer, authorizer, callback) {
  var message = Message.createFromBuffer(buffer);
  var community;
  if (message.version == Version3) {
    message.user = authorizer.users.filter((localUser) => localUser.name == message.msgSecurityParameters.msgUserName)[0];
    message.disableAuthentication = authorizer.disableAuthorization;
    if (!message.user) {
      if (message.msgSecurityParameters.msgUserName != "" && !authorizer.disableAuthorization) {
        if (message.isReportable()) {
          return {
            original: message,
            report: true,
            errorType: UsmErrorType.UNKNOWN_USER_NAME
          };
        }
        callback(new RequestFailedError("Local user not found for message with user " + message.msgSecurityParameters.msgUserName));
        return;
      } else if (message.hasAuthentication()) {
        if (message.isReportable()) {
          return {
            original: message,
            report: true,
            errorType: UsmErrorType.UNKNOWN_USER_NAME
          };
        }
        callback(new RequestFailedError("Local user not found and message requires authentication with user " + message.msgSecurityParameters.msgUserName));
        return;
      } else {
        message.user = {
          name: "",
          level: SecurityLevel.noAuthNoPriv
        };
      }
    }
    if ((message.user.level == SecurityLevel.authNoPriv || message.user.level == SecurityLevel.authPriv) && !message.hasAuthentication()) {
      if (message.isReportable()) {
        return {
          original: message,
          report: true,
          errorType: UsmErrorType.WRONG_DIGESTS
        };
      }
      callback(new RequestFailedError("Local user " + message.msgSecurityParameters.msgUserName + " requires authentication but message does not provide it"));
      return;
    }
    if (message.user.level == SecurityLevel.authPriv && !message.hasPrivacy()) {
      if (message.isReportable()) {
        return {
          original: message,
          report: true,
          errorType: UsmErrorType.WRONG_DIGESTS
        };
      }
      callback(new RequestFailedError("Local user " + message.msgSecurityParameters.msgUserName + " requires privacy but message does not provide it"));
      return;
    }
    if (!message.processIncomingSecurity(message.user, callback)) {
      return;
    }
  } else {
    community = authorizer.communities.filter((localCommunity) => localCommunity == message.community)[0];
    if (!community && !authorizer.disableAuthorization) {
      callback(new RequestFailedError("Local community not found for message with community " + message.community));
      return;
    }
  }
  return message;
};
Listener.prototype.close = function(callback) {
  for (const socket of Object.values(this.sockets)) {
    if (callback) {
      const socketInfo = socket.address();
      const socketCallback = () => {
        callback(socketInfo);
      };
      socket.close(socketCallback);
    } else {
      socket.close();
    }
  }
};
var Authorizer = function(options) {
  this.communities = [];
  this.users = [];
  this.disableAuthorization = options.disableAuthorization;
  this.accessControlModelType = options.accessControlModelType || AccessControlModelType.None;
  if (this.accessControlModelType == AccessControlModelType.None) {
    this.accessControlModel = null;
  } else if (this.accessControlModelType == AccessControlModelType.Simple) {
    this.accessControlModel = new SimpleAccessControlModel;
  }
};
Authorizer.prototype.addCommunity = function(community) {
  if (this.getCommunity(community)) {
    return;
  } else {
    this.communities.push(community);
    if (this.accessControlModelType == AccessControlModelType.Simple) {
      this.accessControlModel.setCommunityAccess(community, AccessLevel.ReadOnly);
    }
  }
};
Authorizer.prototype.getCommunity = function(community) {
  return this.communities.filter((localCommunity) => localCommunity == community)[0] || null;
};
Authorizer.prototype.getCommunities = function() {
  return this.communities;
};
Authorizer.prototype.deleteCommunity = function(community) {
  var index = this.communities.indexOf(community);
  if (index > -1) {
    this.communities.splice(index, 1);
  }
};
Authorizer.prototype.addUser = function(user) {
  if (this.getUser(user.name)) {
    this.deleteUser(user.name);
  }
  this.users.push(user);
  if (this.accessControlModelType == AccessControlModelType.Simple) {
    this.accessControlModel.setUserAccess(user.name, AccessLevel.ReadOnly);
  }
};
Authorizer.prototype.getUser = function(userName) {
  return this.users.filter((localUser) => localUser.name == userName)[0] || null;
};
Authorizer.prototype.getUsers = function() {
  return this.users;
};
Authorizer.prototype.deleteUser = function(userName) {
  var index = this.users.findIndex((localUser) => localUser.name == userName);
  if (index > -1) {
    this.users.splice(index, 1);
  }
};
Authorizer.prototype.getAccessControlModelType = function() {
  return this.accessControlModelType;
};
Authorizer.prototype.getAccessControlModel = function() {
  return this.accessControlModel;
};
Authorizer.prototype.isAccessAllowed = function(securityModel, securityName, pduType) {
  if (this.accessControlModel) {
    return this.accessControlModel.isAccessAllowed(securityModel, securityName, pduType);
  } else {
    return true;
  }
};
var SimpleAccessControlModel = function() {
  this.communitiesAccess = [];
  this.usersAccess = [];
};
SimpleAccessControlModel.prototype.getCommunityAccess = function(community) {
  return this.communitiesAccess.find((entry) => entry.community == community);
};
SimpleAccessControlModel.prototype.getCommunityAccessLevel = function(community) {
  var communityAccessEntry = this.getCommunityAccess(community);
  return communityAccessEntry ? communityAccessEntry.level : AccessLevel.None;
};
SimpleAccessControlModel.prototype.getCommunitiesAccess = function() {
  return this.communitiesAccess;
};
SimpleAccessControlModel.prototype.setCommunityAccess = function(community, accessLevel) {
  let accessEntry = this.getCommunityAccess(community);
  if (accessEntry) {
    accessEntry.level = accessLevel;
  } else {
    this.communitiesAccess.push({
      community,
      level: accessLevel
    });
    this.communitiesAccess.sort((a, b) => a.community > b.community ? 1 : -1);
  }
};
SimpleAccessControlModel.prototype.removeCommunityAccess = function(community) {
  this.communitiesAccess.splice(this.communitiesAccess.findIndex((entry) => entry.community == community), 1);
};
SimpleAccessControlModel.prototype.getUserAccess = function(userName) {
  return this.usersAccess.find((entry) => entry.userName == userName);
};
SimpleAccessControlModel.prototype.getUserAccessLevel = function(user) {
  var userAccessEntry = this.getUserAccess(user);
  return userAccessEntry ? userAccessEntry.level : AccessLevel.None;
};
SimpleAccessControlModel.prototype.getUsersAccess = function() {
  return this.usersAccess;
};
SimpleAccessControlModel.prototype.setUserAccess = function(userName, accessLevel) {
  let accessEntry = this.getUserAccess(userName);
  if (accessEntry) {
    accessEntry.level = accessLevel;
  } else {
    this.usersAccess.push({
      userName,
      level: accessLevel
    });
    this.usersAccess.sort((a, b) => a.userName > b.userName ? 1 : -1);
  }
};
SimpleAccessControlModel.prototype.removeUserAccess = function(userName) {
  this.usersAccess.splice(this.usersAccess.findIndex((entry) => entry.userName == userName), 1);
};
SimpleAccessControlModel.prototype.isAccessAllowed = function(securityModel, securityName, pduType) {
  var accessLevelConfigured;
  var accessLevelRequired;
  switch (securityModel) {
    case Version1:
    case Version2c:
      accessLevelConfigured = this.getCommunityAccessLevel(securityName);
      break;
    case Version3:
      accessLevelConfigured = this.getUserAccessLevel(securityName);
      break;
  }
  switch (pduType) {
    case PduType.SetRequest:
      accessLevelRequired = AccessLevel.ReadWrite;
      break;
    case PduType.GetRequest:
    case PduType.GetNextRequest:
    case PduType.GetBulkRequest:
      accessLevelRequired = AccessLevel.ReadOnly;
      break;
    default:
      accessLevelRequired = AccessLevel.None;
      break;
  }
  switch (accessLevelRequired) {
    case AccessLevel.ReadWrite:
      return accessLevelConfigured == AccessLevel.ReadWrite;
    case AccessLevel.ReadOnly:
      return accessLevelConfigured == AccessLevel.ReadWrite || accessLevelConfigured == AccessLevel.ReadOnly;
    case AccessLevel.None:
      return true;
    default:
      return false;
  }
};
var Receiver = function(options, callback) {
  DEBUG |= options.debug;
  this.authorizer = new Authorizer(options);
  this.engine = new Engine({
    engineID: options.engineID
  });
  this.engineBoots = 0;
  this.engineTime = 10;
  this.disableAuthorization = false;
  this.callback = callback;
  this.family = options.transport || "udp4";
  this.port = options.port || 162;
  options.port = this.port;
  this.disableAuthorization = options.disableAuthorization || false;
  this.includeAuthentication = options.includeAuthentication || false;
  this.context = options && options.context ? options.context : "";
  this.listener = new Listener(options, this);
};
Receiver.prototype.getAuthorizer = function() {
  return this.authorizer;
};
Receiver.prototype.onMsg = function(socket, buffer, rinfo) {
  let message;
  try {
    message = Listener.processIncoming(buffer, this.authorizer, this.callback);
  } catch (error) {
    this.callback(new ProcessingError("Failure to process incoming message", error, rinfo, buffer));
    return;
  }
  if (!message) {
    return;
  }
  if (message.report && message.original) {
    let reportMessage = message.original.createReportResponseMessage(this.engine, this.context, message.errorType);
    this.listener.send(reportMessage, rinfo, socket);
    return;
  }
  if (message.pdu.type == PduType.GetRequest) {
    if (message.version != Version3) {
      this.callback(new RequestInvalidError("Only SNMPv3 discovery GetRequests are supported"));
      return;
    } else if (message.hasAuthentication()) {
      this.callback(new RequestInvalidError("Only discovery (noAuthNoPriv) GetRequests are supported but this message has authentication"));
      return;
    } else if (!message.isReportable()) {
      this.callback(new RequestInvalidError("Only discovery GetRequests are supported and this message does not have the reportable flag set"));
      return;
    }
    let reportMessage = message.createReportResponseMessage(this.engine, this.context, UsmErrorType.UNKNOWN_ENGINE_ID);
    this.listener.send(reportMessage, rinfo, socket);
    return;
  }
  if (message.pdu.type == PduType.Trap || message.pdu.type == PduType.TrapV2) {
    this.callback(null, this.formatCallbackData(message, rinfo));
  } else if (message.pdu.type == PduType.InformRequest) {
    message.pdu.type = PduType.GetResponse;
    message.buffer = null;
    message.setReportable(false);
    this.listener.send(message, rinfo, socket);
    message.pdu.type = PduType.InformRequest;
    this.callback(null, this.formatCallbackData(message, rinfo));
  } else {
    this.callback(new RequestInvalidError("Unexpected PDU type " + message.pdu.type + " (" + PduType[message.pdu.type] + ")"));
  }
};
Receiver.prototype.formatCallbackData = function(message, rinfo) {
  if (message.pdu.contextEngineID) {
    message.pdu.contextEngineID = message.pdu.contextEngineID.toString("hex");
  }
  delete message.pdu.nonRepeaters;
  delete message.pdu.maxRepetitions;
  const formattedData = {
    pdu: message.pdu,
    rinfo
  };
  if (this.includeAuthentication) {
    if (message.community) {
      formattedData.pdu.community = message.community;
    } else if (message.user) {
      formattedData.pdu.user = message.user.name;
    }
  }
  return formattedData;
};
Receiver.prototype.close = function(callback) {
  this.listener.close(callback);
};
Receiver.create = function(options, callback) {
  var receiver = new Receiver(options, callback);
  receiver.listener.startListening();
  return receiver;
};
var ModuleStore = function(baseModules) {
  this.baseModules = baseModules ?? ModuleStore.BASE_MODULES;
  this.parser = mibparser();
  this.translations = {
    oidToPath: {},
    oidToModule: {},
    pathToOid: {},
    pathToModule: {},
    moduleToOid: {},
    moduleToPath: {}
  };
};
ModuleStore.prototype.getSyntaxTypes = function() {
  var syntaxTypes = {};
  Object.assign(syntaxTypes, ObjectType);
  var entryArray;
  for (var mibModule of Object.values(this.parser.Modules)) {
    entryArray = Object.values(mibModule);
    for (var mibEntry of entryArray) {
      if (mibEntry.MACRO == "TEXTUAL-CONVENTION") {
        if (mibEntry.SYNTAX && !syntaxTypes[mibEntry.ObjectName]) {
          if (typeof mibEntry.SYNTAX == "object") {
            syntaxTypes[mibEntry.ObjectName] = mibEntry.SYNTAX;
          } else {
            syntaxTypes[mibEntry.ObjectName] = syntaxTypes[mibEntry.SYNTAX];
          }
        }
      } else if (!mibEntry.OID && !syntaxTypes[mibEntry.ObjectName]) {
        if (mibEntry.SYNTAX) {
          syntaxTypes[mibEntry.ObjectName] = mibEntry.SYNTAX;
        } else {
          syntaxTypes[mibEntry.ObjectName] = syntaxTypes[mibEntry.MACRO];
        }
      }
    }
  }
  return syntaxTypes;
};
ModuleStore.prototype.loadFromFile = function(fileName) {
  var modulesBeforeLoad = this.getModuleNames();
  this.parser.Import(fileName);
  this.parser.Serialize();
  var modulesAfterLoad = this.getModuleNames();
  var newModulesForTranslation = modulesAfterLoad.filter((moduleName) => modulesBeforeLoad.indexOf(moduleName) === -1);
  newModulesForTranslation.forEach((moduleName) => this.addTranslationsForModule(moduleName));
};
ModuleStore.prototype.addTranslationsForModule = function(moduleName) {
  var mibModule = this.parser.Modules[moduleName];
  if (!mibModule) {
    throw new ReferenceError("MIB module " + moduleName + " not loaded");
  }
  var entryArray = Object.values(mibModule);
  for (var i = 0;i < entryArray.length; i++) {
    var mibEntry = entryArray[i];
    var oid = mibEntry.OID;
    var namedPath = mibEntry.NameSpace;
    var moduleQualifiedName;
    if (mibEntry.ObjectName) {
      moduleQualifiedName = moduleName + "::" + mibEntry.ObjectName;
    } else {
      moduleQualifiedName = undefined;
    }
    if (oid && namedPath) {
      this.translations.oidToPath[oid] = namedPath;
      this.translations.pathToOid[namedPath] = oid;
    }
    if (oid && moduleQualifiedName) {
      this.translations.oidToModule[oid] = moduleQualifiedName;
      this.translations.moduleToOid[moduleQualifiedName] = oid;
    }
    if (namedPath && moduleQualifiedName) {
      this.translations.pathToModule[namedPath] = moduleQualifiedName;
      this.translations.moduleToPath[moduleQualifiedName] = namedPath;
    }
  }
};
ModuleStore.prototype.getModule = function(moduleName) {
  return this.parser.Modules[moduleName];
};
ModuleStore.prototype.getModules = function(includeBase) {
  var modules = {};
  for (var moduleName of Object.keys(this.parser.Modules)) {
    if (includeBase || this.baseModules.indexOf(moduleName) == -1) {
      modules[moduleName] = this.parser.Modules[moduleName];
    }
  }
  return modules;
};
ModuleStore.prototype.getModuleNames = function(includeBase) {
  var modules = [];
  for (var moduleName of Object.keys(this.parser.Modules)) {
    if (includeBase || this.baseModules.indexOf(moduleName) == -1) {
      modules.push(moduleName);
    }
  }
  return modules;
};
ModuleStore.prototype.getProvidersForModule = function(moduleName) {
  var mibModule = this.parser.Modules[moduleName];
  var scalars = [];
  var tables = [];
  var mibEntry;
  var syntaxTypes;
  var entryArray;
  var currentTableProvider;
  var parentOid;
  var constraintsResults;
  var constraints;
  if (!mibModule) {
    throw new ReferenceError("MIB module " + moduleName + " not loaded");
  }
  syntaxTypes = this.getSyntaxTypes();
  entryArray = Object.values(mibModule);
  for (var i = 0;i < entryArray.length; i++) {
    mibEntry = entryArray[i];
    var syntax = mibEntry.SYNTAX;
    var access = mibEntry["ACCESS"];
    var maxAccess = typeof mibEntry["MAX-ACCESS"] != "undefined" ? mibEntry["MAX-ACCESS"] : access ? AccessToMaxAccess[access] : "not-accessible";
    var defVal = mibEntry["DEFVAL"];
    if (syntax) {
      constraintsResults = ModuleStore.getConstraintsFromSyntax(syntax, syntaxTypes);
      syntax = constraintsResults.syntax;
      constraints = constraintsResults.constraints;
      if (syntax.startsWith("SEQUENCE OF")) {
        currentTableProvider = {
          tableName: mibEntry.ObjectName,
          type: MibProviderType.Table,
          tableColumns: [],
          tableIndex: [1]
        };
        currentTableProvider.maxAccess = MaxAccess[maxAccess];
        while (currentTableProvider || i >= entryArray.length) {
          i++;
          mibEntry = entryArray[i];
          if (!mibEntry) {
            tables.push(currentTableProvider);
            currentTableProvider = null;
            i--;
            break;
          }
          syntax = mibEntry.SYNTAX;
          access = mibEntry["ACCESS"];
          maxAccess = typeof mibEntry["MAX-ACCESS"] != "undefined" ? mibEntry["MAX-ACCESS"] : access ? AccessToMaxAccess[access] : "not-accessible";
          defVal = mibEntry["DEFVAL"];
          constraintsResults = ModuleStore.getConstraintsFromSyntax(syntax, syntaxTypes);
          syntax = constraintsResults.syntax;
          constraints = constraintsResults.constraints;
          if (mibEntry.MACRO == "SEQUENCE") {} else if (!mibEntry["OBJECT IDENTIFIER"]) {} else {
            parentOid = mibEntry["OBJECT IDENTIFIER"].split(" ")[0];
            if (parentOid == currentTableProvider.tableName) {
              currentTableProvider.name = mibEntry.ObjectName;
              currentTableProvider.oid = mibEntry.OID;
              if (mibEntry.INDEX) {
                currentTableProvider.tableIndex = [];
                for (var indexEntry of mibEntry.INDEX) {
                  indexEntry = indexEntry.trim();
                  if (indexEntry.includes(" ")) {
                    if (indexEntry.split(" ")[0] == "IMPLIED") {
                      currentTableProvider.tableIndex.push({
                        columnName: indexEntry.split(" ")[1],
                        implied: true
                      });
                    } else {
                      currentTableProvider.tableIndex.push({
                        columnName: indexEntry.split(" ").slice(-1)[0]
                      });
                    }
                  } else {
                    currentTableProvider.tableIndex.push({
                      columnName: indexEntry
                    });
                  }
                }
              }
              if (mibEntry.AUGMENTS) {
                currentTableProvider.tableAugments = mibEntry.AUGMENTS[0].trim();
                currentTableProvider.tableIndex = null;
              }
            } else if (parentOid == currentTableProvider.name) {
              let columnType = syntaxTypes[syntax];
              if (typeof columnType === "object") {
                columnType = syntaxTypes[Object.keys(columnType)[0]];
              }
              var columnDefinition = {
                number: parseInt(mibEntry["OBJECT IDENTIFIER"].split(" ")[1]),
                name: mibEntry.ObjectName,
                type: columnType,
                maxAccess: MaxAccess[maxAccess]
              };
              if (constraints) {
                columnDefinition.constraints = constraints;
              }
              if (defVal) {
                columnDefinition.defVal = defVal;
              }
              if (syntax == "RowStatus" && "IMPORTS" in mibModule && Array.isArray(mibModule.IMPORTS["SNMPv2-TC"]) && mibModule.IMPORTS["SNMPv2-TC"].includes("RowStatus")) {
                columnDefinition.rowStatus = true;
              }
              currentTableProvider.tableColumns.push(columnDefinition);
            } else {
              tables.push(currentTableProvider);
              currentTableProvider = null;
              i--;
            }
          }
        }
      } else if (mibEntry.MACRO == "OBJECT-TYPE") {
        let scalarType = syntaxTypes[syntax];
        if (typeof scalarType === "object") {
          scalarType = syntaxTypes[Object.keys(scalarType)[0]];
        }
        var scalarDefinition = {
          name: mibEntry.ObjectName,
          type: MibProviderType.Scalar,
          oid: mibEntry.OID,
          scalarType,
          maxAccess: MaxAccess[maxAccess]
        };
        if (defVal) {
          scalarDefinition.defVal = defVal;
        }
        if (constraints) {
          scalarDefinition.constraints = constraints;
        }
        scalars.push(scalarDefinition);
      }
    }
  }
  return scalars.concat(tables);
};
ModuleStore.prototype.loadBaseModules = function() {
  for (var mibModule of this.baseModules) {
    this.parser.Import(__dirname + "/lib/mibs/" + mibModule + ".mib");
  }
  this.parser.Serialize();
  this.getModuleNames(true).forEach((moduleName) => this.addTranslationsForModule(moduleName));
};
ModuleStore.getConstraintsFromSyntax = function(syntax, syntaxTypes) {
  let constraints;
  if (typeof syntaxTypes[syntax] === "object") {
    syntax = syntaxTypes[syntax];
  }
  if (typeof syntax == "object") {
    let firstSyntaxKey = syntax[Object.keys(syntax)[0]];
    if (firstSyntaxKey.ranges) {
      constraints = {
        ranges: firstSyntaxKey.ranges
      };
      syntax = Object.keys(syntax)[0];
    } else if (firstSyntaxKey.sizes) {
      constraints = {
        sizes: firstSyntaxKey.sizes
      };
      syntax = Object.keys(syntax)[0];
    } else {
      constraints = {
        enumeration: syntax.INTEGER
      };
      syntax = "INTEGER";
    }
  } else {
    constraints = null;
  }
  return {
    constraints,
    syntax
  };
};
ModuleStore.prototype.translate = function(name, destinationFormat) {
  var sourceFormat;
  if (name.includes("::")) {
    sourceFormat = OidFormat.module;
  } else if (name.startsWith("1.")) {
    sourceFormat = OidFormat.oid;
  } else {
    sourceFormat = OidFormat.path;
  }
  var lowercaseDestinationFormat = destinationFormat.toLowerCase();
  if (sourceFormat === lowercaseDestinationFormat) {
    var testMap;
    switch (sourceFormat) {
      case OidFormat.oid: {
        testMap = "oidToPath";
        break;
      }
      case OidFormat.path: {
        testMap = "pathToOid";
        break;
      }
      case OidFormat.module: {
        testMap = "moduleToOid";
        break;
      }
    }
    var entryExists = this.translations[testMap][name];
    if (entryExists === undefined) {
      throw new Error("No translation found for " + name);
    } else {
      return name;
    }
  } else {
    var capitalizedDestinationFormat = destinationFormat.charAt(0).toUpperCase() + destinationFormat.slice(1).toLowerCase();
    var translationMap = sourceFormat + "To" + capitalizedDestinationFormat;
    var translation = this.translations[translationMap][name];
    if (!translation) {
      throw new Error("No '" + destinationFormat + "' translation found for " + name);
    } else {
      return translation;
    }
  }
};
ModuleStore.create = function(options) {
  const store = new ModuleStore(options?.baseModules ?? ModuleStore.BASE_MODULES);
  store.loadBaseModules();
  return store;
};
ModuleStore.BASE_MODULES = [
  "RFC1155-SMI",
  "RFC1158-MIB",
  "RFC-1212",
  "RFC1213-MIB",
  "RFC-1215",
  "SNMPv2-SMI",
  "SNMPv2-CONF",
  "SNMPv2-TC",
  "SNMPv2-MIB"
];
var MibNode = function(address, parent) {
  this.address = address;
  this.oid = this.address.join(".");
  this.parent = parent;
  this.children = {};
};
MibNode.prototype.child = function(index) {
  return this.children[index];
};
MibNode.prototype.listChildren = function(lowest) {
  var sorted = [];
  lowest = lowest || 0;
  this.children.forEach(function(c, i) {
    if (i >= lowest)
      sorted.push(i);
  });
  sorted.sort(function(a, b) {
    return a - b;
  });
  return sorted;
};
MibNode.prototype.findChildImmediatelyBefore = function(index) {
  var sortedChildrenKeys = Object.keys(this.children).sort(function(a, b) {
    return a - b;
  });
  if (sortedChildrenKeys.length === 0) {
    return null;
  }
  for (var i = 0;i < sortedChildrenKeys.length; i++) {
    if (index < sortedChildrenKeys[i]) {
      if (i === 0) {
        return null;
      } else {
        return this.children[sortedChildrenKeys[i - 1]];
      }
    }
  }
  return this.children[sortedChildrenKeys[sortedChildrenKeys.length - 1]];
};
MibNode.prototype.isDescendant = function(address) {
  return MibNode.oidIsDescended(this.address, address);
};
MibNode.prototype.isAncestor = function(address) {
  return MibNode.oidIsDescended(address, this.address);
};
MibNode.prototype.getAncestorProvider = function() {
  if (this.provider) {
    return this;
  } else if (!this.parent) {
    return null;
  } else {
    return this.parent.getAncestorProvider();
  }
};
MibNode.prototype.getTableColumnFromInstanceNode = function() {
  if (this.parent && this.parent.provider) {
    return this.address[this.address.length - 1];
  } else if (!this.parent) {
    return null;
  } else {
    return this.parent.getTableColumnFromInstanceNode();
  }
};
MibNode.prototype.getConstraintsFromProvider = function() {
  var providerNode = this.getAncestorProvider();
  if (!providerNode) {
    return null;
  }
  var provider = providerNode.provider;
  if (provider.type == MibProviderType.Scalar) {
    return provider.constraints;
  } else if (provider.type == MibProviderType.Table) {
    var columnNumber = this.getTableColumnFromInstanceNode();
    if (!columnNumber) {
      return null;
    }
    var columnDefinition = provider.tableColumns.filter((column) => column.number == columnNumber)[0];
    return columnDefinition ? columnDefinition.constraints : null;
  } else {
    return null;
  }
};
MibNode.prototype.validateValue = function(typeFromSet, valueFromSet) {
  const constraints = this.getConstraintsFromProvider();
  return ObjectTypeUtil.isValid(typeFromSet, valueFromSet, constraints);
};
MibNode.prototype.getInstanceNodeForTableRow = function() {
  var childCount = Object.keys(this.children).length;
  if (childCount == 0) {
    if (this.value != null) {
      return this;
    } else {
      return null;
    }
  } else if (childCount == 1) {
    return this.children[0].getInstanceNodeForTableRow();
  } else if (childCount > 1) {
    return null;
  }
};
MibNode.prototype.getInstanceNodeForTableRowIndex = function(index) {
  var childCount = Object.keys(this.children).length;
  var remainingIndex;
  if (childCount == 0) {
    if (this.value != null) {
      return this;
    } else {
      return null;
    }
  } else {
    if (index.length == 0) {
      return this.getInstanceNodeForTableRow();
    } else {
      var nextChildIndexPart = index[0];
      if (nextChildIndexPart == null) {
        return null;
      }
      remainingIndex = index.slice(1);
      if (this.children[nextChildIndexPart]) {
        return this.children[nextChildIndexPart].getInstanceNodeForTableRowIndex(remainingIndex);
      } else {
        return null;
      }
    }
  }
};
MibNode.prototype.getInstanceNodesForColumn = function() {
  var columnNode = this;
  var instanceNode = this;
  var instanceNodes = [];
  while (instanceNode && (instanceNode == columnNode || columnNode.isAncestor(instanceNode.address))) {
    instanceNode = instanceNode.getNextInstanceNode();
    if (instanceNode && columnNode.isAncestor(instanceNode.address)) {
      instanceNodes.push(instanceNode);
    }
  }
  return instanceNodes;
};
MibNode.prototype.getNextInstanceNode = function() {
  var siblingIndex;
  var childrenAddresses;
  var node = this;
  if (!node.children || Object.keys(node.children).length === 0) {
    while (node) {
      siblingIndex = node.address.slice(-1)[0];
      node = node.parent;
      if (!node) {
        return null;
      } else {
        childrenAddresses = Object.keys(node.children).sort((a, b) => a - b);
        var siblingPosition = childrenAddresses.indexOf(siblingIndex.toString());
        if (siblingPosition + 1 < childrenAddresses.length) {
          node = node.children[childrenAddresses[siblingPosition + 1]];
          break;
        }
      }
    }
  }
  while (node) {
    if (!node.children || Object.keys(node.children).length === 0) {
      return node;
    }
    childrenAddresses = Object.keys(node.children).sort((a, b) => a - b);
    node = node.children[childrenAddresses[0]];
    if (!node) {
      return null;
    }
  }
};
MibNode.prototype.delete = function() {
  if (Object.keys(this.children) > 0) {
    throw new Error("Cannot delete non-leaf MIB node");
  }
  var addressLastPart = this.address.slice(-1)[0];
  delete this.parent.children[addressLastPart];
  this.parent = null;
};
MibNode.prototype.pruneUpwards = function() {
  if (!this.parent) {
    return;
  }
  if (Object.keys(this.children).length == 0) {
    var lastAddressPart = this.address.splice(-1)[0].toString();
    delete this.parent.children[lastAddressPart];
    this.parent.pruneUpwards();
    this.parent = null;
  }
};
MibNode.prototype.dump = function(options) {
  var valueString;
  if ((!options.leavesOnly || options.showProviders) && this.provider) {
    console.log(this.oid + " [" + MibProviderType[this.provider.type] + ": " + this.provider.name + "]");
  } else if (!options.leavesOnly || Object.keys(this.children).length == 0) {
    if (this.value != null) {
      valueString = " = ";
      valueString += options.showTypes ? ObjectType[this.valueType] + ": " : "";
      valueString += options.showValues ? this.value : "";
    } else {
      valueString = "";
    }
    console.log(this.oid + valueString);
  }
  for (var node of Object.keys(this.children).sort((a, b) => a - b)) {
    this.children[node].dump(options);
  }
};
MibNode.oidIsDescended = function(oid, ancestor) {
  var ancestorAddress = Mib.convertOidToAddress(ancestor);
  var address = Mib.convertOidToAddress(oid);
  var isAncestor = true;
  if (address.length <= ancestorAddress.length) {
    return false;
  }
  ancestorAddress.forEach(function(o, i) {
    if (address[i] !== ancestorAddress[i]) {
      isAncestor = false;
    }
  });
  return isAncestor;
};
var Mib = function(options) {
  var providersByOid;
  this.root = new MibNode([], null);
  this.providerNodes = {};
  this.options = options;
  providersByOid = this.providersByOid = {};
  this.providers = new Proxy({}, {
    set: function(target, key, value) {
      target[key] = value;
      providersByOid[value.oid] = value;
    },
    deleteProperty: function(target, key) {
      delete providersByOid[target[key].oid];
      delete target[key];
    }
  });
};
Mib.prototype.addNodesForOid = function(oidString) {
  var address = Mib.convertOidToAddress(oidString);
  return this.addNodesForAddress(address);
};
Mib.prototype.addNodesForAddress = function(address) {
  var node;
  var i;
  node = this.root;
  for (i = 0;i < address.length; i++) {
    if (!node.children.hasOwnProperty(address[i])) {
      node.children[address[i]] = new MibNode(address.slice(0, i + 1), node);
    }
    node = node.children[address[i]];
  }
  return node;
};
Mib.prototype.lookup = function(oid) {
  var address;
  address = Mib.convertOidToAddress(oid);
  return this.lookupAddress(address);
};
Mib.prototype.lookupAddress = function(address) {
  var i;
  var node;
  node = this.root;
  for (i = 0;i < address.length; i++) {
    if (!node.children.hasOwnProperty(address[i])) {
      return null;
    }
    node = node.children[address[i]];
  }
  return node;
};
Mib.prototype.getTreeNode = function(oid) {
  var address = Mib.convertOidToAddress(oid);
  var node;
  node = this.lookupAddress(address);
  if (node) {
    return node;
  }
  while (address.length > 0) {
    var last = address.pop();
    var parent = this.lookupAddress(address);
    if (parent) {
      node = parent.findChildImmediatelyBefore(last);
      if (!node)
        return parent;
      while (true) {
        var childrenAddresses = Object.keys(node.children).sort((a, b) => a - b);
        if (childrenAddresses.length == 0)
          return node;
        node = node.children[childrenAddresses[childrenAddresses.length - 1]];
      }
    }
  }
  return this.root;
};
Mib.prototype.getProviderNodeForInstance = function(instanceNode) {
  if (instanceNode.provider) {
    return null;
  }
  return instanceNode.getAncestorProvider();
};
Mib.prototype.addProviderToNode = function(provider) {
  const node = this.addNodesForOid(provider.oid);
  node.provider = provider;
  this.providerNodes[provider.name] = node;
  return node;
};
Mib.prototype.getColumnForColumnNumberFromTableProvider = function(provider, columnNumber) {
  const column = provider.tableColumns.find((column2) => column2.number == columnNumber);
  return column;
};
Mib.prototype.getColumnForIndexEntryFromTableProvider = function(provider, indexEntry) {
  let column = null;
  if (indexEntry.columnName) {
    column = provider.tableColumns.filter((column2) => column2.name == indexEntry.columnName)[0];
  } else if (indexEntry.columnNumber !== undefined && indexEntry.columnNumber !== null) {
    column = provider.tableColumns.filter((column2) => column2.number == indexEntry.columnNumber)[0];
  }
  return column;
};
Mib.prototype.populateIndexEntryFromColumn = function(localProvider, indexEntry, i) {
  var column = null;
  var tableProviders;
  if (!indexEntry.columnName && !indexEntry.columnNumber) {
    throw new Error("Index entry " + i + ": does not have either a columnName or columnNumber");
  }
  if (indexEntry.foreign) {
    column = this.getColumnForIndexEntryFromTableProvider(this.providers[indexEntry.foreign], indexEntry);
  } else {
    column = this.getColumnForIndexEntryFromTableProvider(localProvider, indexEntry);
    if (!column) {
      tableProviders = Object.values(this.providers).filter((prov) => prov.type == MibProviderType.Table);
      for (var provider of tableProviders) {
        column = this.getColumnForIndexEntryFromTableProvider(provider, indexEntry);
        if (column) {
          indexEntry.foreign = provider.name;
          break;
        }
      }
    }
  }
  if (!column) {
    throw new Error("Could not find column for index entry with column " + indexEntry.columnName);
  }
  if (indexEntry.columnName && indexEntry.columnName != column.name) {
    throw new Error("Index entry " + i + ": Calculated column name " + column.name + "does not match supplied column name " + indexEntry.columnName);
  }
  if (indexEntry.columnNumber && indexEntry.columnNumber != column.number) {
    throw new Error("Index entry " + i + ": Calculated column number " + column.number + " does not match supplied column number " + indexEntry.columnNumber);
  }
  if (!indexEntry.columnName) {
    indexEntry.columnName = column.name;
  }
  if (!indexEntry.columnNumber) {
    indexEntry.columnNumber = column.number;
  }
  indexEntry.type = column.type;
};
Mib.prototype.registerProvider = function(provider) {
  this.providers[provider.name] = provider;
  if (provider.type == MibProviderType.Scalar) {
    if (this.options?.addScalarDefaultsOnRegistration && provider.defVal) {
      let scalarValue;
      if (provider.constraints?.enumeration) {
        scalarValue = ObjectTypeUtil.getEnumerationNumberFromName(provider.constraints.enumeration, provider.defVal);
      } else {
        scalarValue = JSON.parse(provider.defVal);
      }
      this.setScalarValue(provider.name, scalarValue);
    }
  } else if (provider.type == MibProviderType.Table) {
    if (provider.tableAugments) {
      if (provider.tableAugments == provider.name) {
        throw new Error("Table " + provider.name + " cannot augment itself");
      }
      var augmentProvider = this.providers[provider.tableAugments];
      if (!augmentProvider) {
        throw new Error("Cannot find base table " + provider.tableAugments + " to augment");
      }
      provider.tableIndex = JSON.parse(JSON.stringify(augmentProvider.tableIndex));
      provider.tableIndex.map((index) => index.foreign = augmentProvider.name);
    } else {
      if (!provider.tableIndex) {
        provider.tableIndex = [1];
      }
      for (var i = 0;i < provider.tableIndex.length; i++) {
        var indexEntry = provider.tableIndex[i];
        if (typeof indexEntry == "number") {
          provider.tableIndex[i] = {
            columnNumber: indexEntry
          };
        } else if (typeof indexEntry == "string") {
          provider.tableIndex[i] = {
            columnName: indexEntry
          };
        }
        indexEntry = provider.tableIndex[i];
        this.populateIndexEntryFromColumn(provider, indexEntry, i);
      }
    }
  }
};
Mib.prototype.setScalarDefaultValue = function(name, value) {
  let provider = this.getProvider(name);
  provider.defVal = value;
};
Mib.prototype.setTableRowDefaultValues = function(name, values) {
  let provider = this.getProvider(name);
  let tc = provider.tableColumns;
  if (values.length != tc.length) {
    throw new Error(`Incorrect values length: got ${values.length}; expected ${tc.length}`);
  }
  tc.forEach((entry, i) => {
    if (typeof values[i] != "undefined") {
      entry.defVal = values[i];
    }
  });
};
Mib.prototype.setScalarRanges = function(name, ranges) {
  let provider = this.getProvider(name);
  provider.constraints = { ranges };
};
Mib.prototype.setTableColumnRanges = function(name, column, ranges) {
  let provider = this.getProvider(name);
  let tc = provider.tableColumns;
  tc[column].constraints = { ranges };
};
Mib.prototype.setScalarSizes = function(name, sizes) {
  let provider = this.getProvider(name);
  provider.constraints = { sizes };
};
Mib.prototype.setTableColumnSizes = function(name, column, sizes) {
  let provider = this.getProvider(name);
  let tc = provider.tableColumns;
  tc[column].constraints = { sizes };
};
Mib.prototype.registerProviders = function(providers) {
  for (var provider of providers) {
    this.registerProvider(provider);
  }
};
Mib.prototype.unregisterProvider = function(name) {
  var providerNode = this.providerNodes[name];
  if (providerNode) {
    var providerNodeParent = providerNode.parent;
    providerNode.delete();
    providerNodeParent.pruneUpwards();
    delete this.providerNodes[name];
  }
  delete this.providers[name];
};
Mib.prototype.getProvider = function(name) {
  return this.providers[name];
};
Mib.prototype.getProviders = function() {
  return this.providers;
};
Mib.prototype.dumpProviders = function() {
  var extraInfo;
  for (var provider of Object.values(this.providers)) {
    extraInfo = provider.type == MibProviderType.Scalar ? ObjectType[provider.scalarType] : "Columns = " + provider.tableColumns.length;
    console.log(MibProviderType[provider.type] + ": " + provider.name + " (" + provider.oid + "): " + extraInfo);
  }
};
Mib.prototype.getScalarValue = function(scalarName) {
  var providerNode = this.providerNodes[scalarName];
  if (!providerNode || !providerNode.provider || providerNode.provider.type != MibProviderType.Scalar) {
    throw new ReferenceError("Failed to get node for registered MIB provider " + scalarName);
  }
  var instanceAddress = providerNode.address.concat([0]);
  if (!this.lookup(instanceAddress)) {
    throw new Error("Failed created instance node for registered MIB provider " + scalarName);
  }
  var instanceNode = this.lookup(instanceAddress);
  return instanceNode.value;
};
Mib.prototype.setScalarValue = function(scalarName, newValue) {
  var providerNode;
  var instanceNode;
  var provider;
  if (!this.providers[scalarName]) {
    throw new ReferenceError("Provider " + scalarName + " not registered with this MIB");
  }
  providerNode = this.providerNodes[scalarName];
  if (!providerNode) {
    providerNode = this.addProviderToNode(this.providers[scalarName]);
  }
  provider = providerNode.provider;
  if (!providerNode || !provider || provider.type != MibProviderType.Scalar) {
    throw new ReferenceError("Could not find MIB node for registered provider " + scalarName);
  }
  var instanceAddress = providerNode.address.concat([0]);
  instanceNode = this.lookup(instanceAddress);
  if (!instanceNode) {
    this.addNodesForAddress(instanceAddress);
    instanceNode = this.lookup(instanceAddress);
    instanceNode.valueType = provider.scalarType;
  }
  const isValidValue = ObjectTypeUtil.isValid(instanceNode.valueType, newValue, provider.constraints);
  if (!isValidValue) {
    throw new TypeError(`Invalid value for ${scalarName} of type ${instanceNode.valueType}: ${newValue}`);
  }
  instanceNode.value = newValue;
};
Mib.prototype.getProviderNodeForTable = function(table) {
  var providerNode;
  var provider;
  providerNode = this.providerNodes[table];
  if (!providerNode) {
    throw new ReferenceError("No MIB provider registered for " + table);
  }
  provider = providerNode.provider;
  if (!providerNode) {
    throw new ReferenceError("No MIB provider definition for registered provider " + table);
  }
  if (provider.type != MibProviderType.Table) {
    throw new TypeError("Registered MIB provider " + table + " is not of the correct type (is type " + MibProviderType[provider.type] + ")");
  }
  return providerNode;
};
Mib.prototype.getOidAddressFromValue = function(value, indexPart) {
  var oidComponents;
  switch (indexPart.type) {
    case ObjectType.OID:
      oidComponents = value.split(".");
      break;
    case ObjectType.OctetString:
      if (value instanceof Buffer2) {
        oidComponents = Array.prototype.slice.call(value);
      } else {
        oidComponents = [...value].map((c) => c.charCodeAt());
      }
      break;
    case ObjectType.IpAddress:
      return value.split(".");
    default:
      return [value];
  }
  if (!indexPart.implied && !indexPart.length) {
    oidComponents.unshift(oidComponents.length);
  }
  return oidComponents;
};
Mib.prototype.getTableRowInstanceFromRow = function(provider, row) {
  var rowIndex = [];
  var foreignColumnParts;
  var localColumnParts;
  var localColumnPosition;
  var oidArrayForValue;
  foreignColumnParts = provider.tableIndex.filter((indexPart) => indexPart.foreign);
  for (var i = 0;i < foreignColumnParts.length; i++) {
    oidArrayForValue = this.getOidAddressFromValue(row[i], foreignColumnParts[i]);
    rowIndex = rowIndex.concat(oidArrayForValue);
  }
  localColumnParts = provider.tableIndex.filter((indexPart) => !indexPart.foreign);
  for (var localColumnPart of localColumnParts) {
    localColumnPosition = provider.tableColumns.findIndex((column) => column.number == localColumnPart.columnNumber);
    oidArrayForValue = this.getOidAddressFromValue(row[foreignColumnParts.length + localColumnPosition], localColumnPart);
    rowIndex = rowIndex.concat(oidArrayForValue);
  }
  return rowIndex;
};
Mib.getRowIndexFromOid = function(oid, index) {
  var addressRemaining = oid.split(".");
  var length = 0;
  var values = [];
  var value;
  for (var indexPart of index) {
    switch (indexPart.type) {
      case ObjectType.OID:
        if (indexPart.implied) {
          length = addressRemaining.length;
        } else {
          length = addressRemaining.shift();
        }
        value = addressRemaining.splice(0, length);
        values.push(value.join("."));
        break;
      case ObjectType.IpAddress:
        length = 4;
        value = addressRemaining.splice(0, length);
        values.push(value.join("."));
        break;
      case ObjectType.OctetString:
        if (indexPart.implied) {
          length = addressRemaining.length;
        } else {
          length = addressRemaining.shift();
        }
        value = addressRemaining.splice(0, length);
        value = value.map((c) => String.fromCharCode(c)).join("");
        values.push(value);
        break;
      default:
        values.push(parseInt(addressRemaining.shift()));
    }
  }
  return values;
};
Mib.prototype.getTableRowInstanceFromRowIndex = function(provider, rowIndex) {
  var rowIndexOid = [];
  var indexPart;
  var keyPart;
  for (var i = 0;i < provider.tableIndex.length; i++) {
    indexPart = provider.tableIndex[i];
    keyPart = rowIndex[i];
    rowIndexOid = rowIndexOid.concat(this.getOidAddressFromValue(keyPart, indexPart));
  }
  return rowIndexOid;
};
Mib.prototype.validateTableRow = function(table, row) {
  const provider = this.providers[table];
  const tableIndex = provider.tableIndex;
  const foreignIndexOffset = tableIndex.filter((indexPart) => indexPart.foreign).length;
  for (let i = 0;i < provider.tableColumns.length; i++) {
    const providerColumn = provider.tableColumns[i];
    const isColumnIndex = tableIndex.some((indexPart) => indexPart.columnNumber == providerColumn.number);
    if (!isColumnIndex || !(providerColumn.maxAccess === MaxAccess["not-accessible"] || providerColumn.maxAccess === MaxAccess["accessible-for-notify"])) {
      const rowValueIndex = foreignIndexOffset + i;
      const isValidValue = ObjectTypeUtil.isValid(providerColumn.type, row[rowValueIndex], providerColumn.constraints);
      if (!isValidValue) {
        throw new TypeError(`Invalid value for ${table} column ${providerColumn.name} (index ${rowValueIndex}): ${row[rowValueIndex]} (in row [${row}])`);
      }
    }
  }
};
Mib.prototype.addTableRow = function(table, row) {
  var providerNode;
  var provider;
  var instance = [];
  var instanceAddress;
  var instanceNode;
  var rowValueOffset;
  if (!this.providers[table]) {
    throw new ReferenceError("Provider " + table + " not registered with this MIB");
  }
  this.validateTableRow(table, row);
  if (!this.providerNodes[table]) {
    this.addProviderToNode(this.providers[table]);
  }
  providerNode = this.getProviderNodeForTable(table);
  provider = providerNode.provider;
  rowValueOffset = provider.tableIndex.filter((indexPart) => indexPart.foreign).length;
  instance = this.getTableRowInstanceFromRow(provider, row);
  for (var i = 0;i < provider.tableColumns.length; i++) {
    var column = provider.tableColumns[i];
    var isColumnIndex = provider.tableIndex.some((indexPart) => indexPart.columnNumber == column.number);
    if (!isColumnIndex || !(column.maxAccess === MaxAccess["not-accessible"] || column.maxAccess === MaxAccess["accessible-for-notify"])) {
      instanceAddress = providerNode.address.concat(column.number).concat(instance);
      this.addNodesForAddress(instanceAddress);
      instanceNode = this.lookup(instanceAddress);
      instanceNode.valueType = column.type;
      instanceNode.value = row[rowValueOffset + i];
    }
  }
};
Mib.prototype.getTableColumnDefinitions = function(table) {
  const provider = this.providers[table];
  return provider.tableColumns;
};
Mib.prototype.getTableColumnCells = function(table, columnNumber, includeInstances) {
  var provider = this.providers[table];
  var providerIndex = provider.tableIndex;
  var providerNode = this.getProviderNodeForTable(table);
  var columnNode = providerNode.children[columnNumber];
  if (!columnNode) {
    return null;
  }
  var instanceNodes = columnNode.getInstanceNodesForColumn();
  var instanceOid;
  var indexValues = [];
  var columnValues = [];
  for (var instanceNode of instanceNodes) {
    instanceOid = Mib.getSubOidFromBaseOid(instanceNode.oid, columnNode.oid);
    indexValues.push(Mib.getRowIndexFromOid(instanceOid, providerIndex));
    columnValues.push(instanceNode.value);
  }
  if (includeInstances) {
    return [indexValues, columnValues];
  } else {
    return columnValues;
  }
};
Mib.prototype.getTableRowCells = function(table, rowIndex) {
  var provider;
  var providerNode;
  var columnNode;
  var instanceAddress;
  var instanceNode;
  var row = [];
  var rowFound = false;
  provider = this.providers[table];
  providerNode = this.getProviderNodeForTable(table);
  instanceAddress = this.getTableRowInstanceFromRowIndex(provider, rowIndex);
  for (var columnNumber of Object.keys(providerNode.children)) {
    columnNode = providerNode.children[columnNumber];
    if (columnNode) {
      instanceNode = columnNode.getInstanceNodeForTableRowIndex(instanceAddress);
      if (instanceNode) {
        row.push(instanceNode.value);
        rowFound = true;
      } else {
        row.push(null);
      }
    } else {
      row.push(null);
    }
  }
  if (rowFound) {
    return row;
  } else {
    return null;
  }
};
Mib.prototype.getTableCells = function(table, byRows, includeInstances) {
  var providerNode;
  var column;
  var data = [];
  providerNode = this.getProviderNodeForTable(table);
  for (var columnNumber of Object.keys(providerNode.children)) {
    column = this.getTableColumnCells(table, columnNumber, includeInstances);
    if (includeInstances) {
      data.push(...column);
      includeInstances = false;
    } else {
      data.push(column);
    }
  }
  if (byRows) {
    return Object.keys(data[0]).map(function(c) {
      return data.map(function(r) {
        return r[c];
      });
    });
  } else {
    return data;
  }
};
Mib.prototype.getTableSingleCell = function(table, columnNumber, rowIndex) {
  var provider;
  var providerNode;
  var instanceAddress;
  var columnNode;
  var instanceNode;
  provider = this.providers[table];
  providerNode = this.getProviderNodeForTable(table);
  instanceAddress = this.getTableRowInstanceFromRowIndex(provider, rowIndex);
  columnNode = providerNode.children[columnNumber];
  instanceNode = columnNode.getInstanceNodeForTableRowIndex(instanceAddress);
  return instanceNode.value;
};
Mib.prototype.setTableSingleCell = function(table, columnNumber, rowIndex, value) {
  const provider = this.providers[table];
  const providerNode = this.getProviderNodeForTable(table);
  const instanceAddress = this.getTableRowInstanceFromRowIndex(provider, rowIndex);
  const columnNode = providerNode.children[columnNumber];
  const instanceNode = columnNode.getInstanceNodeForTableRowIndex(instanceAddress);
  const providerColumn = this.getColumnForColumnNumberFromTableProvider(provider, columnNumber);
  const isValidValue = ObjectTypeUtil.isValid(instanceNode.valueType, value, providerColumn?.constraints);
  if (!isValidValue) {
    throw new TypeError(`Invalid value for ${table} column ${columnNumber} of type ${instanceNode.valueType}: ${value}`);
  }
  instanceNode.value = value;
};
Mib.prototype.deleteTableRow = function(table, rowIndex) {
  var provider;
  var providerNode;
  var instanceAddress;
  var columnNode;
  var instanceNode;
  var instanceParentNode;
  provider = this.providers[table];
  providerNode = this.getProviderNodeForTable(table);
  instanceAddress = this.getTableRowInstanceFromRowIndex(provider, rowIndex);
  for (var columnNumber of Object.keys(providerNode.children)) {
    columnNode = providerNode.children[columnNumber];
    instanceNode = columnNode.getInstanceNodeForTableRowIndex(instanceAddress);
    if (instanceNode) {
      instanceParentNode = instanceNode.parent;
      instanceNode.delete();
      instanceParentNode.pruneUpwards();
    } else {
      throw new ReferenceError("Cannot find row for index " + rowIndex + " at registered provider " + table);
    }
  }
  if (Object.keys(this.providerNodes[table].children).length === 0) {
    delete this.providerNodes[table];
  }
  return true;
};
Mib.prototype.getAncestorProviderFromOid = function(oid) {
  const address = Mib.convertOidToAddress(oid);
  for (let i = address.length - 1;i >= 0; i--) {
    const oidToCheck = address.slice(0, i).join(".");
    const provider = this.providersByOid[oidToCheck];
    if (provider) {
      return provider;
    }
  }
  return null;
};
Mib.prototype.dump = function(options) {
  if (!options) {
    options = {};
  }
  var completedOptions = {
    leavesOnly: options.leavesOnly === undefined ? true : options.leavesOnly,
    showProviders: options.showProviders === undefined ? true : options.showProviders,
    showValues: options.showValues === undefined ? true : options.showValues,
    showTypes: options.showTypes === undefined ? true : options.showTypes
  };
  this.root.dump(completedOptions);
};
Mib.convertOidToAddress = function(oid) {
  var address;
  var oidArray;
  var i;
  if (typeof oid === "object" && Array.isArray(oid)) {
    address = oid;
  } else if (typeof oid === "string") {
    address = oid.split(".");
  } else {
    throw new TypeError("oid (string or array) is required");
  }
  if (address.length < 1)
    throw new RangeError("object identifier is too short");
  oidArray = [];
  for (i = 0;i < address.length; i++) {
    var n;
    if (address[i] === "")
      continue;
    if (address[i] === true || address[i] === false) {
      throw new TypeError("object identifier component " + address[i] + " is malformed");
    }
    n = Number(address[i]);
    if (isNaN(n)) {
      throw new TypeError("object identifier component " + address[i] + " is malformed");
    }
    if (n % 1 !== 0) {
      throw new TypeError("object identifier component " + address[i] + " is not an integer");
    }
    if (i === 0 && n > 2) {
      throw new RangeError("object identifier does not " + "begin with 0, 1, or 2");
    }
    if (i === 1 && n > 39) {
      throw new RangeError("object identifier second " + "component " + n + " exceeds encoding limit of 39");
    }
    if (n < 0) {
      throw new RangeError("object identifier component " + address[i] + " is negative");
    }
    if (n > MAX_SIGNED_INT32) {
      throw new RangeError("object identifier component " + address[i] + " is too large");
    }
    oidArray.push(n);
  }
  return oidArray;
};
Mib.getSubOidFromBaseOid = function(oid, base) {
  return oid.substring(base.length + 1);
};
Mib.create = function(options) {
  return new Mib(options);
};
var MibRequest = function(requestDefinition) {
  this.operation = requestDefinition.operation;
  this.address = Mib.convertOidToAddress(requestDefinition.oid);
  this.oid = this.address.join(".");
  this.providerNode = requestDefinition.providerNode;
  this.provider = this.providerNode ? this.providerNode.provider : null;
  this.instanceNode = requestDefinition.instanceNode;
};
MibRequest.prototype.isScalar = function() {
  return this.providerNode && this.providerNode.provider && this.providerNode.provider.type == MibProviderType.Scalar;
};
MibRequest.prototype.isTabular = function() {
  return this.providerNode && this.providerNode.provider && this.providerNode.provider.type == MibProviderType.Table;
};
var Agent = function(options, callback, mib) {
  DEBUG |= options.debug;
  this.listener = new Listener(options, this);
  this.engine = new Engine({
    engineID: options.engineID
  });
  this.authorizer = new Authorizer(options);
  this.callback = callback || function() {};
  const mibOptions = mib?.options || options?.mibOptions || {};
  this.mib = mib || new Mib(mibOptions);
  this.context = "";
  this.forwarder = new Forwarder(this.listener, this.callback);
};
Agent.prototype.getMib = function() {
  return this.mib;
};
Agent.prototype.setMib = function(mib) {
  this.mib = mib;
};
Agent.prototype.getAuthorizer = function() {
  return this.authorizer;
};
Agent.prototype.registerProvider = function(provider) {
  this.mib.registerProvider(provider);
};
Agent.prototype.registerProviders = function(providers) {
  this.mib.registerProviders(providers);
};
Agent.prototype.unregisterProvider = function(name) {
  this.mib.unregisterProvider(name);
};
Agent.prototype.getProvider = function(name) {
  return this.mib.getProvider(name);
};
Agent.prototype.getProviders = function() {
  return this.mib.getProviders();
};
Agent.prototype.scalarReadCreateHandlerInternal = function(createRequest) {
  let provider = createRequest.provider;
  if (provider && typeof provider.defVal != "undefined") {
    return provider.defVal;
  }
  return;
};
Agent.prototype.tableRowStatusHandlerInternal = function(createRequest) {
  let provider = createRequest.provider;
  let action = createRequest.action;
  let row = createRequest.row;
  let values = [];
  let missingDefVal = false;
  let rowIndexValues = Array.isArray(row) ? row.slice(0) : [row];
  const tc = provider.tableColumns;
  tc.forEach((columnInfo) => {
    let entries;
    entries = provider.tableIndex.filter((entry) => columnInfo.number === entry.columnNumber);
    if (entries.length > 0) {
      values.push(rowIndexValues.shift());
    } else if (columnInfo.rowStatus) {
      values.push(RowStatus[action]);
    } else if ("defVal" in columnInfo) {
      values.push(columnInfo.defVal);
    } else {
      console.log("No defVal defined for column:", columnInfo);
      missingDefVal = true;
      values.push(undefined);
    }
  });
  return missingDefVal ? undefined : values;
};
Agent.prototype.onMsg = function(socket, buffer, rinfo) {
  let message;
  try {
    message = Listener.processIncoming(buffer, this.authorizer, this.callback);
  } catch (error) {
    this.callback(new ProcessingError("Failure to process incoming message", error, rinfo, buffer));
    return;
  }
  if (!message) {
    return;
  }
  if (message.report && message.original) {
    let reportMessage = message.original.createReportResponseMessage(this.engine, this.context, message.errorType);
    this.listener.send(reportMessage, rinfo, socket);
    return;
  }
  if (message.version == Version3 && message.pdu.type == PduType.GetRequest && !message.hasAuthoritativeEngineID() && message.isReportable()) {
    let reportMessage = message.createReportResponseMessage(this.engine, this.context, UsmErrorType.UNKNOWN_ENGINE_ID);
    this.listener.send(reportMessage, rinfo, socket);
    return;
  }
  debug(message.pdu);
  if (message.pdu.contextName && message.pdu.contextName != "") {
    this.onProxyRequest(socket, message, rinfo);
  } else if (message.pdu.type == PduType.GetRequest) {
    this.getRequest(socket, message, rinfo);
  } else if (message.pdu.type == PduType.SetRequest) {
    this.setRequest(socket, message, rinfo);
  } else if (message.pdu.type == PduType.GetNextRequest) {
    this.getNextRequest(socket, message, rinfo);
  } else if (message.pdu.type == PduType.GetBulkRequest) {
    this.getBulkRequest(socket, message, rinfo);
  } else {
    this.callback(new RequestInvalidError("Unexpected PDU type " + message.pdu.type + " (" + PduType[message.pdu.type] + ")"));
  }
};
Agent.prototype.tryCreateInstance = function(varbind, requestType) {
  var row;
  var column;
  var value;
  var subOid;
  var subAddr;
  var address;
  var fullAddress;
  var rowStatusColumn;
  var provider;
  var providersByOid = this.mib.providersByOid;
  var oid = varbind.oid;
  var createRequest;
  fullAddress = Mib.convertOidToAddress(oid);
  for (address = fullAddress.slice(0);address.length > 0; address.pop()) {
    subOid = address.join(".");
    provider = providersByOid[subOid];
    if (provider) {
      if (provider.type === MibProviderType.Scalar) {
        if (provider.maxAccess != MaxAccess["read-create"]) {
          return;
        }
        if (provider.createHandler === null) {
          return;
        }
        createRequest = {
          provider
        };
        value = (provider.createHandler || this.scalarReadCreateHandlerInternal)(createRequest);
        if (typeof value == "undefined") {
          return;
        }
        value = ObjectTypeUtil.castSetValue(provider.scalarType, value);
        this.mib.setScalarValue(provider.name, value);
        return {
          instanceNode: this.mib.lookup(oid),
          providerType: MibProviderType.Scalar
        };
      }
      subOid = Mib.getSubOidFromBaseOid(oid, provider.oid);
      subAddr = subOid.split(".");
      column = parseInt(subAddr.shift(), 10);
      row = Mib.getRowIndexFromOid(subAddr.join("."), provider.tableIndex);
      rowStatusColumn = provider.tableColumns.reduce((acc, current) => current.rowStatus ? current.number : acc, null);
      if (requestType === PduType.SetRequest && typeof rowStatusColumn == "number" && column === rowStatusColumn) {
        if ((varbind.value === RowStatus["createAndGo"] || varbind.value === RowStatus["createAndWait"]) && provider.createHandler !== null) {
          createRequest = {
            provider,
            action: RowStatus[varbind.value],
            row
          };
          value = (provider.createHandler || this.tableRowStatusHandlerInternal)(createRequest);
          if (typeof value == "undefined") {
            return;
          }
          if (!Array.isArray(value)) {
            throw new Error("createHandler must return an array or undefined; got", value);
          }
          if (value.length != provider.tableColumns.length) {
            throw new Error("createHandler's returned array must contain a value for for each column");
          }
          value = value.map((v, i) => ObjectTypeUtil.castSetValue(provider.tableColumns[i].type, v));
          this.mib.addTableRow(provider.name, value);
          return {
            instanceNode: this.mib.lookup(oid),
            providerType: MibProviderType.Table,
            action: RowStatus[varbind.value],
            rowIndex: row,
            row: value
          };
        }
      }
      return;
    }
  }
  return;
};
Agent.prototype.isAllowed = function(pduType, provider, instanceNode) {
  var column;
  var maxAccess;
  var columnEntry;
  if (provider.type === MibProviderType.Scalar) {
    maxAccess = provider.maxAccess;
  } else {
    column = instanceNode.getTableColumnFromInstanceNode();
    columnEntry = provider.tableColumns.find((entry) => entry.number === column);
    maxAccess = columnEntry ? columnEntry.maxAccess || MaxAccess["not-accessible"] : MaxAccess["not-accessible"];
  }
  switch (PduType[pduType]) {
    case "SetRequest":
      return maxAccess >= MaxAccess["read-write"];
    case "GetRequest":
    case "GetNextRequest":
    case "GetBulkRequest":
      return maxAccess >= MaxAccess["read-only"];
    default:
      return false;
  }
};
Agent.prototype.request = function(socket, requestMessage, rinfo) {
  var me = this;
  var varbindsCompleted = 0;
  var requestPdu = requestMessage.pdu;
  var varbindsLength = requestPdu.varbinds.length;
  var responsePdu = requestPdu.getResponsePduForRequest();
  var mibRequests = [];
  var createResult = [];
  var oldValues = [];
  var securityName = requestMessage.version == Version3 ? requestMessage.user.name : requestMessage.community;
  const isSetRequest = requestPdu.type === PduType.SetRequest;
  for (let i = 0;i < requestPdu.varbinds.length; i++) {
    let instanceNode = this.mib.lookup(requestPdu.varbinds[i].oid);
    let providerNode;
    let rowStatusColumn;
    let getIcsHandler;
    if (!instanceNode) {
      createResult[i] = this.tryCreateInstance(requestPdu.varbinds[i], requestPdu.type);
      if (createResult[i]) {
        instanceNode = createResult[i].instanceNode;
      }
    }
    if (requestPdu.varbinds[i].oid.split(".").length < 4) {
      requestPdu.varbinds[i].oid = "1.3.6.1";
    }
    if (!instanceNode) {
      mibRequests[i] = new MibRequest({
        operation: requestPdu.type,
        oid: requestPdu.varbinds[i].oid
      });
      const ancestorProvider = this.mib.getAncestorProviderFromOid(requestPdu.varbinds[i].oid);
      if (ancestorProvider) {
        mibRequests[i].handler = function getNsiHandler(mibRequestForNsi) {
          mibRequestForNsi.done({
            errorStatus: ErrorStatus.NoError,
            type: ObjectType.NoSuchInstance,
            value: null
          });
        };
      } else {
        mibRequests[i].handler = function getNsoHandler(mibRequestForNso) {
          mibRequestForNso.done({
            errorStatus: ErrorStatus.NoError,
            type: ObjectType.NoSuchObject,
            value: null
          });
        };
      }
    } else {
      providerNode = this.mib.getProviderNodeForInstance(instanceNode);
      if (!providerNode || instanceNode.value === undefined) {
        mibRequests[i] = new MibRequest({
          operation: requestPdu.type,
          oid: requestPdu.varbinds[i].oid
        });
        mibRequests[i].handler = function getNsiHandler(mibRequestForNsi) {
          mibRequestForNsi.done({
            errorStatus: ErrorStatus.NoError,
            type: ObjectType.NoSuchInstance,
            value: null
          });
        };
      } else if (!this.isAllowed(requestPdu.type, providerNode.provider, instanceNode)) {
        mibRequests[i] = new MibRequest({
          operation: requestPdu.type,
          oid: requestPdu.varbinds[i].oid
        });
        mibRequests[i].handler = function getRanaHandler(mibRequestForRana) {
          mibRequestForRana.done({
            errorStatus: ErrorStatus.NoAccess,
            type: ObjectType.Null,
            value: null
          });
        };
      } else if (this.authorizer.getAccessControlModelType() == AccessControlModelType.Simple && !this.authorizer.getAccessControlModel().isAccessAllowed(requestMessage.version, securityName, requestMessage.pdu.type)) {
        mibRequests[i] = new MibRequest({
          operation: requestPdu.type,
          oid: requestPdu.varbinds[i].oid
        });
        mibRequests[i].handler = function getAccessDeniedHandler(mibRequestForAccessDenied) {
          mibRequestForAccessDenied.done({
            errorStatus: ErrorStatus.NoAccess,
            type: ObjectType.Null,
            value: null
          });
        };
      } else if (isSetRequest && providerNode.provider.type == MibProviderType.Table && typeof (rowStatusColumn = providerNode.provider.tableColumns.reduce((acc, current) => current.rowStatus ? current.number : acc, null)) == "number" && instanceNode.getTableColumnFromInstanceNode() === rowStatusColumn) {
        getIcsHandler = function(mibRequestForIcs) {
          mibRequestForIcs.done({
            errorStatus: ErrorStatus.InconsistentValue,
            type: ObjectType.Null,
            value: null
          });
        };
        requestPdu.varbinds[i].requestValue = ObjectTypeUtil.castSetValue(requestPdu.varbinds[i].type, requestPdu.varbinds[i].value);
        switch (requestPdu.varbinds[i].value) {
          case RowStatus["active"]:
          case RowStatus["notInService"]:
            break;
          case RowStatus["destroy"]:
            break;
          case RowStatus["createAndGo"]:
            if (instanceNode.value === RowStatus["createAndGo"]) {
              requestPdu.varbinds[i].value = RowStatus["active"];
            } else {
              mibRequests[i] = new MibRequest({
                operation: requestPdu.type,
                oid: requestPdu.varbinds[i].oid
              });
              mibRequests[i].handler = getIcsHandler;
            }
            break;
          case RowStatus["createAndWait"]:
            if (instanceNode.value === RowStatus["createAndWait"]) {
              requestPdu.varbinds[i].value = RowStatus["notInService"];
            } else {
              mibRequests[i] = new MibRequest({
                operation: requestPdu.type,
                oid: requestPdu.varbinds[i].oid
              });
              mibRequests[i].handler = getIcsHandler;
            }
            break;
          case RowStatus["notReady"]:
          default:
            mibRequests[i] = new MibRequest({
              operation: requestPdu.type,
              oid: requestPdu.varbinds[i].oid
            });
            mibRequests[i].handler = getIcsHandler;
            break;
        }
      }
      if (isSetRequest && !createResult[i]) {
        oldValues[i] = instanceNode.value;
      }
      if (!mibRequests[i]) {
        mibRequests[i] = new MibRequest({
          operation: requestPdu.type,
          providerNode,
          instanceNode,
          oid: requestPdu.varbinds[i].oid
        });
        mibRequests[i].handler = providerNode.provider.handler;
        if (isSetRequest) {
          mibRequests[i].setType = instanceNode.valueType;
          mibRequests[i].setValue = requestPdu.varbinds[i].requestValue ?? requestPdu.varbinds[i].value;
          try {
            mibRequests[i].setValue = ObjectTypeUtil.castSetValue(mibRequests[i].setType, mibRequests[i].setValue);
            if (!mibRequests[i].instanceNode.validateValue(mibRequests[i].setType, mibRequests[i].setValue)) {
              mibRequests[i].handler = function badValueHandler(request) {
                request.done({
                  errorStatus: ErrorStatus.BadValue,
                  type: ObjectType.Null,
                  value: null
                });
              };
            }
          } catch (e) {
            debug("Invalid value for type", e, mibRequests[i]);
            mibRequests[i].handler = function wrongTypeHandler(request) {
              request.done({
                errorStatus: ErrorStatus.WrongType,
                type: ObjectType.Null,
                value: null
              });
            };
          }
        }
      }
    }
    (function(savedIndex) {
      const mibRequest = mibRequests[savedIndex];
      mibRequest.done = function(error) {
        mibRequest.error = error ?? { errorStatus: ErrorStatus.NoError };
        let responseVarbind;
        let rowIndex = null;
        let row = null;
        let deleted = false;
        let column = -1;
        responseVarbind = {
          oid: mibRequest.oid
        };
        if (error) {
          if ((typeof responsePdu.errorStatus == "undefined" || responsePdu.errorStatus == ErrorStatus.NoError) && error.errorStatus != ErrorStatus.NoError) {
            responsePdu.errorStatus = error.errorStatus;
            responsePdu.errorIndex = savedIndex + 1;
          }
          responseVarbind.type = error.type || ObjectType.Null;
          responseVarbind.value = error.value ?? null;
          if (error.errorStatus != ErrorStatus.NoError) {
            responseVarbind.errorStatus = error.errorStatus;
          }
        } else {
          const instanceNode2 = mibRequest.instanceNode;
          const providerNode2 = mibRequest.providerNode;
          const provider = providerNode2 ? providerNode2.provider : null;
          const providerName = provider ? provider.name : null;
          let subOid;
          let subAddr;
          if (providerNode2 && providerNode2.provider && providerNode2.provider.type == MibProviderType.Table) {
            column = instanceNode2.getTableColumnFromInstanceNode();
            subOid = Mib.getSubOidFromBaseOid(instanceNode2.oid, provider.oid);
            subAddr = subOid.split(".");
            subAddr.shift();
            rowIndex = Mib.getRowIndexFromOid(subAddr.join("."), provider.tableIndex);
            row = me.mib.getTableRowCells(providerName, rowIndex);
          }
          if (isSetRequest && mibRequest.commitSet) {
            let rowStatusColumn2 = provider.type == MibProviderType.Table ? provider.tableColumns.reduce((acc, current) => current.rowStatus ? current.number : acc, null) : null;
            if (requestPdu.varbinds[savedIndex].value === RowStatus["destroy"] && typeof rowStatusColumn2 == "number" && column === rowStatusColumn2) {
              me.mib.deleteTableRow(providerName, rowIndex);
              deleted = true;
            } else {
              mibRequest.instanceNode.value = mibRequest.setValue;
            }
          }
          if ((requestPdu.type == PduType.GetNextRequest || requestPdu.type == PduType.GetBulkRequest) && requestPdu.varbinds[savedIndex].type == ObjectType.EndOfMibView) {
            responseVarbind.type = ObjectType.EndOfMibView;
          } else {
            responseVarbind.type = mibRequest.instanceNode.valueType;
          }
          responseVarbind.value = mibRequest.instanceNode.value;
          if (responseVarbind.value === undefined || responseVarbind.value === null) {
            responseVarbind.type = ObjectType.NoSuchInstance;
          }
        }
        if (providerNode && providerNode.provider && providerNode.provider.name) {
          responseVarbind.providerName = providerNode.provider.name;
        }
        if (requestPdu.type == PduType.GetNextRequest || requestPdu.type == PduType.GetNextRequest) {
          responseVarbind.previousOid = requestPdu.varbinds[savedIndex].previousOid;
        }
        const isTestSet = mibRequest.testSet;
        if (isSetRequest) {
          if (mibRequest.testSet) {
            delete mibRequest.testSet;
            mibRequest.commitSet = true;
            if (mibRequest.error.errorStatus === ErrorStatus.NoError)
              delete mibRequest.error;
          }
          if (oldValues[savedIndex] !== undefined) {
            responseVarbind.oldValue = oldValues[savedIndex];
          }
          responseVarbind.requestType = mibRequests[savedIndex].setType;
          responseVarbind.requestValue = mibRequests[savedIndex].setValue;
        }
        if (createResult[savedIndex]) {
          responseVarbind.autoCreated = true;
        } else if (deleted) {
          responseVarbind.deleted = true;
        }
        if (providerNode && providerNode.provider.type == MibProviderType.Table) {
          responseVarbind.column = column;
          responseVarbind.columnPosition = providerNode.provider.tableColumns.findIndex((tc) => tc.number == column);
          responseVarbind.rowIndex = rowIndex;
          if (!deleted && rowIndex) {
            row = me.mib.getTableRowCells(providerNode.provider.name, rowIndex);
          }
          responseVarbind.row = row;
        }
        me.setSingleVarbind(responsePdu, savedIndex, responseVarbind);
        if (++varbindsCompleted == varbindsLength) {
          if (isTestSet && !responsePdu.errorIndex) {
            varbindsCompleted = 0;
            setImmediate(() => applySetHandlers(false));
            return;
          }
          me.sendResponse.call(me, socket, rinfo, requestMessage, responsePdu);
        }
      };
      if (isSetRequest)
        mibRequest.testSet = true;
    })(i);
  }
  const applyHandlers = (testSet) => {
    for (const mibRequest of mibRequests) {
      if (mibRequest.error === undefined && testSet === !!mibRequest.testSet) {
        if (mibRequest.handler) {
          mibRequest.handler(mibRequest);
        } else {
          mibRequest.done();
        }
      }
    }
  };
  const applySetHandlers = (testSet) => {
    if (this.bulkSetHandler) {
      const errorStatus = this.bulkSetHandler(mibRequests, this.mib, testSet) ?? ErrorStatus.NoError;
      if (errorStatus !== ErrorStatus.NoError) {
        for (const mibRequest of mibRequests) {
          if (mibRequest.error === undefined) {
            mibRequest.done({
              errorStatus,
              type: ObjectType.Null,
              value: null
            });
          }
        }
      }
    }
    applyHandlers(testSet);
  };
  if (isSetRequest)
    applySetHandlers(true);
  else
    applyHandlers(false);
};
Agent.prototype.setBulkSetHandler = function setBulkSetHandler(cb) {
  this.bulkSetHandler = cb;
};
Agent.prototype.getRequest = function(socket, requestMessage, rinfo) {
  this.request(socket, requestMessage, rinfo);
};
Agent.prototype.setRequest = function(socket, requestMessage, rinfo) {
  this.request(socket, requestMessage, rinfo);
};
Agent.prototype.addGetNextVarbind = function(targetVarbinds, startOid) {
  var startNode;
  var getNextNode;
  try {
    startNode = this.mib.lookup(startOid);
  } catch (error) {
    startOid = "1.3.6.1";
    startNode = this.mib.lookup(startOid);
  }
  if (!startNode) {
    startNode = this.mib.getTreeNode(startOid);
  }
  getNextNode = startNode.getNextInstanceNode();
  if (!getNextNode) {
    targetVarbinds.push({
      previousOid: startOid,
      oid: startOid,
      type: ObjectType.EndOfMibView,
      value: null
    });
  } else {
    targetVarbinds.push({
      previousOid: startOid,
      oid: getNextNode.oid,
      type: getNextNode.valueType,
      value: getNextNode.value
    });
  }
  return getNextNode;
};
Agent.prototype.getNextRequest = function(socket, requestMessage, rinfo) {
  var requestPdu = requestMessage.pdu;
  var varbindsLength = requestPdu.varbinds.length;
  var getNextVarbinds = [];
  for (var i = 0;i < varbindsLength; i++) {
    this.addGetNextVarbind(getNextVarbinds, requestPdu.varbinds[i].oid);
  }
  requestMessage.pdu.varbinds = getNextVarbinds;
  this.request(socket, requestMessage, rinfo);
};
Agent.prototype.getBulkRequest = function(socket, requestMessage, rinfo) {
  var requestPdu = requestMessage.pdu;
  var requestVarbinds = requestPdu.varbinds;
  var getBulkVarbinds = [];
  var startOid = [];
  var getNextNode;
  var endOfMib = false;
  for (var n = 0;n < Math.min(requestPdu.nonRepeaters, requestVarbinds.length); n++) {
    this.addGetNextVarbind(getBulkVarbinds, requestVarbinds[n].oid);
  }
  if (requestPdu.nonRepeaters < requestVarbinds.length) {
    for (var v = requestPdu.nonRepeaters;v < requestVarbinds.length; v++) {
      startOid.push(requestVarbinds[v].oid);
    }
    while (getBulkVarbinds.length < requestPdu.maxRepetitions && !endOfMib) {
      for (var w = requestPdu.nonRepeaters;w < requestVarbinds.length; w++) {
        if (getBulkVarbinds.length < requestPdu.maxRepetitions) {
          getNextNode = this.addGetNextVarbind(getBulkVarbinds, startOid[w - requestPdu.nonRepeaters]);
          if (getNextNode) {
            startOid[w - requestPdu.nonRepeaters] = getNextNode.oid;
            if (getNextNode.type == ObjectType.EndOfMibView) {
              endOfMib = true;
            }
          }
        }
      }
    }
  }
  requestMessage.pdu.varbinds = getBulkVarbinds;
  this.request(socket, requestMessage, rinfo);
};
Agent.prototype.setSingleVarbind = function(responsePdu, index, responseVarbind) {
  responsePdu.varbinds[index] = responseVarbind;
};
Agent.prototype.sendResponse = function(socket, rinfo, requestMessage, responsePdu) {
  var responseMessage = requestMessage.createResponseForRequest(responsePdu);
  this.listener.send(responseMessage, rinfo, socket);
  this.callback(null, Listener.formatCallbackData(responseMessage.pdu, rinfo));
};
Agent.prototype.onProxyRequest = function(socket, message, rinfo) {
  var contextName = message.pdu.contextName;
  var proxy;
  var proxiedPduId;
  var proxiedUser;
  if (message.version != Version3) {
    this.callback(new RequestFailedError("Only SNMP version 3 contexts are supported"));
    return;
  }
  proxy = this.forwarder.getProxy(contextName);
  if (!proxy) {
    this.callback(new RequestFailedError("No proxy found for message received with context " + contextName));
    return;
  }
  if (!proxy.session.msgSecurityParameters) {
    proxy.session.sendV3Discovery(null, null, this.callback, {});
  } else {
    message.msgSecurityParameters = proxy.session.msgSecurityParameters;
    message.setAuthentication(!(proxy.user.level == SecurityLevel.noAuthNoPriv));
    message.setPrivacy(proxy.user.level == SecurityLevel.authPriv);
    proxiedUser = message.user;
    message.user = proxy.user;
    message.buffer = null;
    message.pdu.contextEngineID = proxy.session.msgSecurityParameters.msgAuthoritativeEngineID;
    message.pdu.contextName = "";
    proxiedPduId = message.pdu.id;
    message.pdu.id = _generateId();
    var req = new Req(proxy.session, message, null, this.callback, {}, true);
    req.port = proxy.port;
    req.proxiedRinfo = rinfo;
    req.proxiedPduId = proxiedPduId;
    req.proxiedUser = proxiedUser;
    req.proxiedEngine = this.engine;
    req.proxiedSocket = socket;
    proxy.session.send(req);
  }
};
Agent.prototype.getForwarder = function() {
  return this.forwarder;
};
Agent.prototype.close = function(callback) {
  this.listener.close(callback);
};
Agent.create = function(options, callback, mib) {
  var agent = new Agent(options, callback, mib);
  agent.listener.startListening();
  return agent;
};
var Forwarder = function(listener, callback) {
  this.proxies = {};
  this.listener = listener;
  this.callback = callback;
};
Forwarder.prototype.addProxy = function(proxy) {
  var options = {
    version: Version3,
    port: proxy.port,
    transport: proxy.transport
  };
  proxy.session = Session.createV3(proxy.target, proxy.user, options);
  proxy.session.proxy = proxy;
  proxy.session.proxy.listener = this.listener;
  this.proxies[proxy.context] = proxy;
  proxy.session.sendV3Discovery(null, null, this.callback);
};
Forwarder.prototype.deleteProxy = function(proxyName) {
  var proxy = this.proxies[proxyName];
  if (proxy && proxy.session) {
    proxy.session.close();
  }
  delete this.proxies[proxyName];
};
Forwarder.prototype.getProxy = function(proxyName) {
  return this.proxies[proxyName];
};
Forwarder.prototype.getProxies = function() {
  return this.proxies;
};
Forwarder.prototype.dumpProxies = function() {
  var dump = {};
  for (var proxy of Object.values(this.proxies)) {
    dump[proxy.context] = {
      context: proxy.context,
      target: proxy.target,
      user: proxy.user,
      port: proxy.port
    };
  }
  console.log(JSON.stringify(dump, null, 2));
};
var AgentXPdu = function() {};
AgentXPdu.prototype.toBuffer = function() {
  var buffer = new smartbuffer.SmartBuffer;
  this.writeHeader(buffer);
  switch (this.pduType) {
    case AgentXPduType.Open:
      buffer.writeUInt32BE(this.timeout);
      AgentXPdu.writeOid(buffer, this.oid);
      AgentXPdu.writeOctetString(buffer, this.descr);
      break;
    case AgentXPduType.Close:
      buffer.writeUInt8(5);
      buffer.writeUInt8(0);
      buffer.writeUInt8(0);
      buffer.writeUInt8(0);
      break;
    case AgentXPduType.Register:
      buffer.writeUInt8(this.timeout);
      buffer.writeUInt8(this.priority);
      buffer.writeUInt8(this.rangeSubid);
      buffer.writeUInt8(0);
      AgentXPdu.writeOid(buffer, this.oid);
      break;
    case AgentXPduType.Unregister:
      buffer.writeUInt8(0);
      buffer.writeUInt8(this.priority);
      buffer.writeUInt8(this.rangeSubid);
      buffer.writeUInt8(0);
      AgentXPdu.writeOid(buffer, this.oid);
      break;
    case AgentXPduType.AddAgentCaps:
      AgentXPdu.writeOid(buffer, this.oid);
      AgentXPdu.writeOctetString(buffer, this.descr);
      break;
    case AgentXPduType.RemoveAgentCaps:
      AgentXPdu.writeOid(buffer, this.oid);
      break;
    case AgentXPduType.Notify:
      AgentXPdu.writeVarbinds(buffer, this.varbinds);
      break;
    case AgentXPduType.Ping:
      break;
    case AgentXPduType.Response:
      buffer.writeUInt32BE(this.sysUpTime);
      buffer.writeUInt16BE(this.error);
      buffer.writeUInt16BE(this.index);
      AgentXPdu.writeVarbinds(buffer, this.varbinds);
      break;
    default:
  }
  buffer.writeUInt32BE(buffer.length - 20, 16);
  return buffer.toBuffer();
};
AgentXPdu.prototype.writeHeader = function(buffer) {
  this.flags = this.flags | 16;
  buffer.writeUInt8(1);
  buffer.writeUInt8(this.pduType);
  buffer.writeUInt8(this.flags);
  buffer.writeUInt8(0);
  buffer.writeUInt32BE(this.sessionID);
  buffer.writeUInt32BE(this.transactionID);
  buffer.writeUInt32BE(this.packetID);
  buffer.writeUInt32BE(0);
  return buffer;
};
AgentXPdu.prototype.readHeader = function(buffer) {
  this.version = buffer.readUInt8();
  this.pduType = buffer.readUInt8();
  this.flags = buffer.readUInt8();
  buffer.readUInt8();
  this.sessionID = buffer.readUInt32BE();
  this.transactionID = buffer.readUInt32BE();
  this.packetID = buffer.readUInt32BE();
  this.payloadLength = buffer.readUInt32BE();
};
AgentXPdu.prototype.getResponsePduForRequest = function() {
  const responsePdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.Response,
    sessionID: this.sessionID,
    transactionID: this.transactionID,
    packetID: this.packetID,
    sysUpTime: 0,
    error: 0,
    index: 0
  });
  return responsePdu;
};
AgentXPdu.createFromVariables = function(vars) {
  var pdu = new AgentXPdu;
  pdu.flags = vars.flags ? vars.flags | 16 : 16;
  pdu.pduType = vars.pduType || AgentXPduType.Open;
  pdu.sessionID = vars.sessionID || 0;
  pdu.transactionID = vars.transactionID || 0;
  pdu.packetID = vars.packetID || ++AgentXPdu.packetID;
  switch (pdu.pduType) {
    case AgentXPduType.Open:
      pdu.timeout = vars.timeout || 0;
      pdu.oid = vars.oid || null;
      pdu.descr = vars.descr || null;
      break;
    case AgentXPduType.Close:
      break;
    case AgentXPduType.Register:
      pdu.timeout = vars.timeout || 0;
      pdu.oid = vars.oid || null;
      pdu.priority = vars.priority || 127;
      pdu.rangeSubid = vars.rangeSubid || 0;
      break;
    case AgentXPduType.Unregister:
      pdu.oid = vars.oid || null;
      pdu.priority = vars.priority || 127;
      pdu.rangeSubid = vars.rangeSubid || 0;
      break;
    case AgentXPduType.AddAgentCaps:
      pdu.oid = vars.oid;
      pdu.descr = vars.descr;
      break;
    case AgentXPduType.RemoveAgentCaps:
      pdu.oid = vars.oid;
      break;
    case AgentXPduType.Notify:
      pdu.varbinds = vars.varbinds;
      break;
    case AgentXPduType.Ping:
      break;
    case AgentXPduType.Response:
      pdu.sysUpTime = vars.sysUpTime || 0;
      pdu.error = vars.error || 0;
      pdu.index = vars.index || 0;
      pdu.varbinds = vars.varbinds || null;
      break;
    case AgentXPduType.TestSet:
      pdu.varbinds = vars.varbinds || null;
      break;
    case AgentXPduType.CommitSet:
    case AgentXPduType.UndoSet:
    case AgentXPduType.CleanupSet:
      break;
    default:
      throw new RequestInvalidError("Unknown PDU type '" + pdu.pduType + "' in created PDU");
  }
  return pdu;
};
AgentXPdu.createFromBuffer = function(socketBuffer) {
  var pdu = new AgentXPdu;
  var buffer = smartbuffer.SmartBuffer.fromBuffer(socketBuffer);
  pdu.readHeader(buffer);
  switch (pdu.pduType) {
    case AgentXPduType.Response:
      pdu.sysUpTime = buffer.readUInt32BE();
      pdu.error = buffer.readUInt16BE();
      pdu.index = buffer.readUInt16BE();
      break;
    case AgentXPduType.Get:
    case AgentXPduType.GetNext:
      pdu.searchRangeList = AgentXPdu.readSearchRangeList(buffer, pdu.payloadLength);
      break;
    case AgentXPduType.GetBulk:
      pdu.nonRepeaters = buffer.readUInt16BE();
      pdu.maxRepetitions = buffer.readUInt16BE();
      pdu.searchRangeList = AgentXPdu.readSearchRangeList(buffer, pdu.payloadLength - 4);
      break;
    case AgentXPduType.TestSet:
      pdu.varbinds = AgentXPdu.readVarbinds(buffer, pdu.payloadLength);
      break;
    case AgentXPduType.CommitSet:
    case AgentXPduType.UndoSet:
    case AgentXPduType.CleanupSet:
      break;
    default:
      throw new RequestInvalidError("Unknown PDU type '" + pdu.pduType + "' in request");
  }
  return pdu;
};
AgentXPdu.writeOid = function(buffer, oid, include = 0) {
  var prefix;
  if (oid) {
    var address = oid.split(".").map(Number);
    if (address.length >= 5 && address.slice(0, 4).join(".") == "1.3.6.1") {
      prefix = address[4];
      address = address.slice(5);
    } else {
      prefix = 0;
    }
    buffer.writeUInt8(address.length);
    buffer.writeUInt8(prefix);
    buffer.writeUInt8(include);
    buffer.writeUInt8(0);
    for (let addressPart of address) {
      buffer.writeUInt32BE(addressPart);
    }
  } else {
    buffer.writeUInt32BE(0);
  }
};
AgentXPdu.writeOctetString = function(buffer, octetString) {
  buffer.writeUInt32BE(octetString.length);
  buffer.writeString(octetString);
  var paddingOctets = (4 - octetString.length % 4) % 4;
  for (let i = 0;i < paddingOctets; i++) {
    buffer.writeUInt8(0);
  }
};
AgentXPdu.writeVarBind = function(buffer, varbind) {
  buffer.writeUInt16BE(varbind.type);
  buffer.writeUInt16BE(0);
  AgentXPdu.writeOid(buffer, varbind.oid);
  if (varbind.type && varbind.oid) {
    switch (varbind.type) {
      case ObjectType.Integer:
        buffer.writeInt32BE(varbind.value);
        break;
      case ObjectType.Counter:
      case ObjectType.Gauge:
      case ObjectType.TimeTicks:
        buffer.writeUInt32BE(varbind.value);
        break;
      case ObjectType.OctetString:
      case ObjectType.Opaque:
        AgentXPdu.writeOctetString(buffer, varbind.value);
        break;
      case ObjectType.OID:
        AgentXPdu.writeOid(buffer, varbind.value);
        break;
      case ObjectType.IpAddress:
        var bytes = varbind.value.split(".");
        if (bytes.length != 4)
          throw new RequestInvalidError("Invalid IP address '" + varbind.value + "'");
        buffer.writeOctetString(buffer, Buffer2.from(bytes));
        break;
      case ObjectType.Counter64:
        buffer.writeUint64(varbind.value);
        break;
      case ObjectType.Null:
      case ObjectType.EndOfMibView:
      case ObjectType.NoSuchObject:
      case ObjectType.NoSuchInstance:
        break;
      default:
        throw new RequestInvalidError("Unknown type '" + varbind.type + "' in request");
    }
  }
};
AgentXPdu.writeVarbinds = function(buffer, varbinds) {
  if (varbinds) {
    for (var i = 0;i < varbinds.length; i++) {
      var varbind = varbinds[i];
      AgentXPdu.writeVarBind(buffer, varbind);
    }
  }
};
AgentXPdu.readOid = function(buffer) {
  var subidLength = buffer.readUInt8();
  var prefix = buffer.readUInt8();
  var include = buffer.readUInt8();
  buffer.readUInt8();
  if (subidLength == 0 && prefix == 0 && include == 0) {
    return null;
  }
  var address = [];
  if (prefix == 0) {
    address = [];
  } else {
    address = [1, 3, 6, 1, prefix];
  }
  for (let i = 0;i < subidLength; i++) {
    address.push(buffer.readUInt32BE());
  }
  var oid = address.join(".");
  return oid;
};
AgentXPdu.readSearchRange = function(buffer) {
  return {
    start: AgentXPdu.readOid(buffer),
    end: AgentXPdu.readOid(buffer)
  };
};
AgentXPdu.readSearchRangeList = function(buffer, payloadLength) {
  var bytesLeft = payloadLength;
  var bufferPosition = buffer.readOffset + 1;
  var searchRangeList = [];
  while (bytesLeft > 0) {
    searchRangeList.push(AgentXPdu.readSearchRange(buffer));
    bytesLeft -= buffer.readOffset + 1 - bufferPosition;
    bufferPosition = buffer.readOffset + 1;
  }
  return searchRangeList;
};
AgentXPdu.readOctetString = function(buffer) {
  var octetStringLength = buffer.readUInt32BE();
  var paddingOctets = (4 - octetStringLength % 4) % 4;
  var octetString = buffer.readString(octetStringLength);
  buffer.readString(paddingOctets);
  return octetString;
};
AgentXPdu.readVarbind = function(buffer) {
  var vtype = buffer.readUInt16BE();
  buffer.readUInt16BE();
  var oid = AgentXPdu.readOid(buffer);
  var value;
  switch (vtype) {
    case ObjectType.Integer:
    case ObjectType.Counter:
    case ObjectType.Gauge:
    case ObjectType.TimeTicks:
      value = buffer.readUInt32BE();
      break;
    case ObjectType.OctetString:
    case ObjectType.IpAddress:
    case ObjectType.Opaque:
      value = AgentXPdu.readOctetString(buffer);
      break;
    case ObjectType.OID:
      value = AgentXPdu.readOid(buffer);
      break;
    case ObjectType.Counter64:
      value = readUint64(buffer);
      break;
    case ObjectType.Null:
    case ObjectType.NoSuchObject:
    case ObjectType.NoSuchInstance:
    case ObjectType.EndOfMibView:
      value = null;
      break;
    default:
      throw new RequestInvalidError("Unknown type '" + vtype + "' in varbind");
  }
  return {
    type: vtype,
    oid,
    value
  };
};
AgentXPdu.readVarbinds = function(buffer, payloadLength) {
  var bytesLeft = payloadLength;
  var bufferPosition = buffer.readOffset + 1;
  var varbindList = [];
  while (bytesLeft > 0) {
    varbindList.push(AgentXPdu.readVarbind(buffer));
    bytesLeft -= buffer.readOffset + 1 - bufferPosition;
    bufferPosition = buffer.readOffset + 1;
  }
  return varbindList;
};
AgentXPdu.packetID = 1;
var Subagent = function(options) {
  DEBUG = options.debug;
  this.mib = options?.mib ?? new Mib(options?.mibOptions);
  this.master = options.master || "localhost";
  this.masterPort = options.masterPort || 705;
  this.timeout = options.timeout || 0;
  this.descr = options.description || "Node net-snmp AgentX sub-agent";
  this.sessionID = 0;
  this.transactionID = 0;
  this.packetID = _generateId();
  this.requestPdus = {};
  this.setTransactions = {};
};
util.inherits(Subagent, events.EventEmitter);
Subagent.prototype.onClose = function() {
  this.emit("close");
};
Subagent.prototype.onError = function(error) {
  this.emit("error", error);
};
Subagent.prototype.getMib = function() {
  return this.mib;
};
Subagent.prototype.connectSocket = function() {
  var me = this;
  this.socket = new net.Socket;
  this.socket.connect(this.masterPort, this.master, function() {
    debug("Connected to '" + me.master + "' on port " + me.masterPort);
  });
  this.socket.on("data", me.onMsg.bind(me));
  this.socket.on("error", me.onError.bind(me));
  this.socket.on("close", me.onClose.bind(me));
};
Subagent.prototype.open = function(callback) {
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.Open,
    timeout: this.timeout,
    oid: this.oid,
    descr: this.descr
  });
  this.sendPdu(pdu, callback);
};
Subagent.prototype.close = function(callback) {
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.Close,
    sessionID: this.sessionID
  });
  this.sendPdu(pdu, callback);
};
Subagent.prototype.registerProvider = function(provider, callback) {
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.Register,
    sessionID: this.sessionID,
    rangeSubid: 0,
    timeout: 5,
    priority: 127,
    oid: provider.oid
  });
  this.mib.registerProvider(provider);
  this.sendPdu(pdu, callback);
};
Subagent.prototype.unregisterProvider = function(name, callback) {
  var provider = this.getProvider(name);
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.Unregister,
    sessionID: this.sessionID,
    rangeSubid: 0,
    priority: 127,
    oid: provider.oid
  });
  this.mib.unregisterProvider(name);
  this.sendPdu(pdu, callback);
};
Subagent.prototype.registerProviders = function(providers, callback) {
  for (var provider of providers) {
    this.registerProvider(provider, callback);
  }
};
Subagent.prototype.getProvider = function(name) {
  return this.mib.getProvider(name);
};
Subagent.prototype.getProviders = function() {
  return this.mib.getProviders();
};
Subagent.prototype.addAgentCaps = function(oid, descr, callback) {
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.AddAgentCaps,
    sessionID: this.sessionID,
    oid,
    descr
  });
  this.sendPdu(pdu, callback);
};
Subagent.prototype.removeAgentCaps = function(oid, callback) {
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.RemoveAgentCaps,
    sessionID: this.sessionID,
    oid
  });
  this.sendPdu(pdu, callback);
};
Subagent.prototype.notify = function(typeOrOid, varbinds, callback) {
  varbinds = varbinds || [];
  if (typeof typeOrOid != "string") {
    typeOrOid = "1.3.6.1.6.3.1.1.5." + (typeOrOid + 1);
  }
  var pduVarbinds = [
    {
      oid: "1.3.6.1.2.1.1.3.0",
      type: ObjectType.TimeTicks,
      value: Math.floor(process.uptime() * 100)
    },
    {
      oid: "1.3.6.1.6.3.1.1.4.1.0",
      type: ObjectType.OID,
      value: typeOrOid
    }
  ];
  pduVarbinds = pduVarbinds.concat(varbinds);
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.Notify,
    sessionID: this.sessionID,
    varbinds: pduVarbinds
  });
  this.sendPdu(pdu, callback);
};
Subagent.prototype.ping = function(callback) {
  var pdu = AgentXPdu.createFromVariables({
    pduType: AgentXPduType.Ping,
    sessionID: this.sessionID
  });
  this.sendPdu(pdu, callback);
};
Subagent.prototype.sendPdu = function(pdu, callback) {
  debug("Sending AgentX " + AgentXPduType[pdu.pduType] + " PDU");
  debug(pdu);
  var buffer = pdu.toBuffer();
  this.socket.write(buffer);
  if (pdu.pduType != AgentXPduType.Response && !this.requestPdus[pdu.packetID]) {
    pdu.callback = callback;
    this.requestPdus[pdu.packetID] = pdu;
  }
};
Subagent.prototype.onMsg = function(buffer, rinfo) {
  var pdu = AgentXPdu.createFromBuffer(buffer);
  debug("Received AgentX " + AgentXPduType[pdu.pduType] + " PDU");
  debug(pdu);
  try {
    switch (pdu.pduType) {
      case AgentXPduType.Response:
        this.response(pdu);
        break;
      case AgentXPduType.Get:
        this.getRequest(pdu);
        break;
      case AgentXPduType.GetNext:
        this.getNextRequest(pdu);
        break;
      case AgentXPduType.GetBulk:
        this.getBulkRequest(pdu);
        break;
      case AgentXPduType.TestSet:
        this.testSet(pdu);
        break;
      case AgentXPduType.CommitSet:
        this.commitSet(pdu);
        break;
      case AgentXPduType.UndoSet:
        this.undoSet(pdu);
        break;
      case AgentXPduType.CleanupSet:
        this.cleanupSet(pdu);
        break;
      default:
        throw new RequestInvalidError("Unknown PDU type '" + pdu.pduType + "' in request");
    }
  } catch (e) {
    console.error(e);
  }
};
Subagent.prototype.response = function(pdu) {
  var requestPdu = this.requestPdus[pdu.packetID];
  if (requestPdu) {
    delete this.requestPdus[pdu.packetID];
    switch (requestPdu.pduType) {
      case AgentXPduType.Open:
        this.sessionID = pdu.sessionID;
        break;
      case AgentXPduType.Close:
        this.socket.end();
        break;
      case AgentXPduType.Register:
      case AgentXPduType.Unregister:
      case AgentXPduType.AddAgentCaps:
      case AgentXPduType.RemoveAgentCaps:
      case AgentXPduType.Notify:
      case AgentXPduType.Ping:
        break;
      default:
        throw new ResponseInvalidError("Response PDU for type '" + requestPdu.pduType + "' not handled", ResponseInvalidCode.EResponseNotHandled);
    }
    if (requestPdu.callback) {
      requestPdu.callback(null, pdu);
    }
  } else {
    throw new ResponseInvalidError("Unexpected Response PDU with packetID " + pdu.packetID, ResponseInvalidCode.EUnexpectedResponse);
  }
};
Subagent.prototype.isAllowed = function(pduType, provider, instanceNode) {
  const requestedAccess = agentXPduTypesRequiringReadAccess.includes(pduType) ? MaxAccess["read-only"] : agentXPduTypesRequiringWriteAccess.includes(pduType) ? MaxAccess["read-write"] : undefined;
  if (requestedAccess === undefined)
    return true;
  if (provider.type === MibProviderType.Scalar)
    return provider.maxAccess >= requestedAccess;
  const column = instanceNode.getTableColumnFromInstanceNode();
  const columnEntry = provider.tableColumns.find((entry) => entry.number === column);
  const maxAccess = columnEntry ? columnEntry.maxAccess || MaxAccess["not-accessible"] : MaxAccess["not-accessible"];
  return maxAccess >= requestedAccess;
};
Subagent.prototype.request = function(pdu, requestVarbinds) {
  const me = this;
  const varbindsLength = requestVarbinds.length;
  const responseVarbinds = [];
  const responsePdu = pdu.getResponsePduForRequest();
  const mibRequests = [];
  let varbindsCompleted = 0;
  let firstVarbindError;
  const isTestSet = pdu.pduType == AgentXPduType.TestSet;
  const isSetRequest = isTestSet || pdu.pduType == AgentXPduType.CommitSet || pdu.pduType == AgentXPduType.UndoSet;
  for (let i = 0;i < varbindsLength; i++) {
    const requestVarbind = requestVarbinds[i];
    const instanceNode = this.mib.lookup(requestVarbind.oid);
    let providerNode;
    let responseVarbindType;
    if (!instanceNode) {
      mibRequests[i] = new MibRequest({
        operation: pdu.pduType,
        oid: requestVarbind.oid
      });
      mibRequests[i].error = {
        errorStatus: ErrorStatus.NoError,
        errorIndex: 0,
        type: ObjectType.NoSuchObject,
        value: null
      };
    } else {
      providerNode = this.mib.getProviderNodeForInstance(instanceNode);
      if (!providerNode) {
        mibRequests[i] = new MibRequest({
          operation: pdu.pduType,
          oid: requestVarbind.oid
        });
        mibRequests[i].error = {
          errorStatus: ErrorStatus.NoError,
          errorIndex: 0,
          type: ObjectType.NoSuchInstance,
          value: null
        };
      } else {
        mibRequests[i] = new MibRequest({
          operation: pdu.pduType,
          providerNode,
          instanceNode,
          oid: requestVarbind.oid
        });
        mibRequests[i].handler = providerNode.provider.handler;
        if (!me.isAllowed(pdu.pduType, mibRequests[i].providerNode?.provider, mibRequests[i].instanceNode)) {
          mibRequests[i].error = {
            errorStatus: ErrorStatus.NoAccess,
            errorIndex: i + 1,
            type: ObjectType.Null,
            value: null
          };
        }
        if (isSetRequest) {
          mibRequests[i].setType = instanceNode.valueType;
          mibRequests[i].setValue = requestVarbind.requestValue ?? requestVarbind.value;
          mibRequests[i].requestIndex = i + 1;
          try {
            mibRequests[i].setValue = ObjectTypeUtil.castSetValue(mibRequests[i].setType, mibRequests[i].setValue);
            if (!mibRequests[i].instanceNode.validateValue(mibRequests[i].setType, mibRequests[i].setValue)) {
              mibRequests[i].error = {
                errorStatus: ErrorStatus.BadValue,
                errorIndex: i + 1,
                type: mibRequests[i].setType,
                value: mibRequests[i].setValue
              };
            }
          } catch (e) {
            debug("Invalid value for type", e, mibRequests[i]);
            mibRequests[i].error = {
              errorStatus: ErrorStatus.WrongType,
              errorIndex: i + 1,
              type: mibRequests[i].setType,
              value: mibRequests[i].setValue
            };
          }
        }
      }
    }
    (function(savedIndex) {
      const mibRequest = mibRequests[savedIndex];
      const requestVarbind2 = requestVarbinds[savedIndex];
      mibRequest.done = function(error) {
        mibRequest.error = error ?? { errorStatus: ErrorStatus.NoError };
        let responseVarbind;
        if (error) {
          responseVarbind = {
            oid: mibRequest.oid,
            type: error.type || ObjectType.Null,
            value: error.value ?? null
          };
          error.errorIndex = savedIndex + 1;
          firstVarbindError = firstVarbindError ?? error;
          if (error.errorStatus != ErrorStatus.NoError) {
            responseVarbind.errorStatus = error.errorStatus;
          }
        } else {
          if (isTestSet) {} else if (pdu.pduType == AgentXPduType.CommitSet) {
            me.setTransactions[pdu.transactionID].originalValue = mibRequest.instanceNode.value;
            mibRequest.instanceNode.value = requestVarbind2.value;
          } else if (pdu.pduType == AgentXPduType.UndoSet) {
            mibRequest.instanceNode.value = me.setTransactions[pdu.transactionID].originalValue;
          }
          if ((pdu.pduType == AgentXPduType.GetNext || pdu.pduType == AgentXPduType.GetBulk) && requestVarbind2.type == ObjectType.EndOfMibView) {
            responseVarbindType = ObjectType.EndOfMibView;
          } else {
            responseVarbindType = mibRequest.instanceNode.valueType;
          }
          responseVarbind = {
            oid: mibRequest.oid,
            type: responseVarbindType,
            value: mibRequest.instanceNode.value
          };
        }
        responseVarbinds[savedIndex] = mibRequest.response = responseVarbind;
        if (++varbindsCompleted == varbindsLength) {
          if (isSetRequest) {
            responsePdu.error = firstVarbindError?.errorStatus ?? 0;
            responsePdu.index = firstVarbindError?.errorIndex ?? 0;
            me.sendResponse.call(me, responsePdu);
          } else {
            me.sendResponse.call(me, responsePdu, responseVarbinds);
          }
        }
      };
      if (isTestSet)
        mibRequests[i].testSet = true;
      else if (pdu.pduType == AgentXPduType.CommitSet)
        mibRequests[i].commitSet = true;
      if (mibRequest.error)
        mibRequest.done(mibRequest.error);
    })(i);
  }
  if (isSetRequest && this.bulkSetHandler) {
    const errorStatus = this.bulkSetHandler(mibRequests, this.mib, isTestSet) ?? ErrorStatus.NoError;
    if (errorStatus !== ErrorStatus.NoError) {
      for (const mibRequest of mibRequests) {
        if (!mibRequest.response) {
          mibRequest.done({
            errorStatus,
            type: ObjectType.Null,
            value: null
          });
        }
      }
      return;
    }
  }
  for (let i = 0;i < requestVarbinds.length; i++) {
    if (!mibRequests[i].response) {
      const handler = mibRequests[i].handler;
      if (handler) {
        handler(mibRequests[i]);
      } else {
        mibRequests[i].done();
      }
    }
  }
};
Subagent.prototype.setBulkSetHandler = function setBulkSetHandler2(cb) {
  this.bulkSetHandler = cb;
};
Subagent.prototype.addGetNextVarbind = function(targetVarbinds, startOid) {
  var startNode;
  var getNextNode;
  try {
    startNode = this.mib.lookup(startOid);
  } catch (error) {
    startOid = "1.3.6.1";
    startNode = this.mib.lookup(startOid);
  }
  if (!startNode) {
    startNode = this.mib.getTreeNode(startOid);
  }
  getNextNode = startNode.getNextInstanceNode();
  if (!getNextNode) {
    targetVarbinds.push({
      oid: startOid,
      type: ObjectType.EndOfMibView,
      value: null
    });
  } else {
    targetVarbinds.push({
      oid: getNextNode.oid,
      type: getNextNode.valueType,
      value: getNextNode.value
    });
  }
  return getNextNode;
};
Subagent.prototype.getRequest = function(pdu) {
  var requestVarbinds = [];
  for (var i = 0;i < pdu.searchRangeList.length; i++) {
    requestVarbinds.push({
      oid: pdu.searchRangeList[i].start,
      value: null,
      type: null
    });
  }
  this.request(pdu, requestVarbinds);
};
Subagent.prototype.getNextRequest = function(pdu) {
  var getNextVarbinds = [];
  for (var i = 0;i < pdu.searchRangeList.length; i++) {
    this.addGetNextVarbind(getNextVarbinds, pdu.searchRangeList[i].start);
  }
  this.request(pdu, getNextVarbinds);
};
Subagent.prototype.getBulkRequest = function(pdu) {
  var getBulkVarbinds = [];
  var startOid = [];
  var getNextNode;
  var endOfMib = false;
  for (var n = 0;n < pdu.nonRepeaters; n++) {
    this.addGetNextVarbind(getBulkVarbinds, pdu.searchRangeList[n].start);
  }
  for (var v = pdu.nonRepeaters;v < pdu.searchRangeList.length; v++) {
    startOid.push(pdu.searchRangeList[v].oid);
  }
  while (getBulkVarbinds.length < pdu.maxRepetitions && !endOfMib) {
    for (var w = pdu.nonRepeaters;w < pdu.searchRangeList.length; w++) {
      if (getBulkVarbinds.length < pdu.maxRepetitions) {
        getNextNode = this.addGetNextVarbind(getBulkVarbinds, startOid[w - pdu.nonRepeaters]);
        if (getNextNode) {
          startOid[w - pdu.nonRepeaters] = getNextNode.oid;
          if (getNextNode.type == ObjectType.EndOfMibView) {
            endOfMib = true;
          }
        }
      }
    }
  }
  this.request(pdu, getBulkVarbinds);
};
Subagent.prototype.sendResponse = function(responsePdu, varbinds) {
  if (varbinds) {
    responsePdu.varbinds = varbinds;
  }
  this.sendPdu(responsePdu, null);
};
Subagent.prototype.testSet = function(setPdu) {
  this.setTransactions[setPdu.transactionID] = setPdu;
  this.request(setPdu, setPdu.varbinds);
};
Subagent.prototype.commitSet = function(setPdu) {
  if (this.setTransactions[setPdu.transactionID]) {
    this.request(setPdu, this.setTransactions[setPdu.transactionID].varbinds);
  } else {
    throw new RequestInvalidError("Unexpected CommitSet PDU with transactionID " + setPdu.transactionID);
  }
};
Subagent.prototype.undoSet = function(setPdu) {
  if (this.setTransactions[setPdu.transactionID]) {
    this.request(setPdu, this.setTransactions[setPdu.transactionID].varbinds);
  } else {
    throw new RequestInvalidError("Unexpected UndoSet PDU with transactionID " + setPdu.transactionID);
  }
};
Subagent.prototype.cleanupSet = function(setPdu) {
  if (this.setTransactions[setPdu.transactionID]) {
    delete this.setTransactions[setPdu.transactionID];
  } else {
    throw new RequestInvalidError("Unexpected CleanupSet PDU with transactionID " + setPdu.transactionID);
  }
};
Subagent.create = function(options) {
  var subagent = new Subagent(options);
  subagent.connectSocket();
  return subagent;
};
var $createSession = Session.create;
var $createV3Session = Session.createV3;
var $createReceiver = Receiver.create;
var $createAgent = Agent.create;
var $createModuleStore = ModuleStore.create;
var $createSubagent = Subagent.create;
var $createMib = Mib.create;
var $isVarbindError = isVarbindError;
var $Version1 = Version1;
var $Version2c = Version2c;
var $RequestFailedError = RequestFailedError;
var $RequestTimedOutError = RequestTimedOutError;

// src/services/snmp.ts
var safeToString = (data, type = "string") => {
  if (data === undefined || data === null)
    return null;
  if (Buffer.isBuffer(data)) {
    if (type === "hex")
      return data.length > 0 ? data.toString("hex").match(/.{1,2}/g)?.join(":") : null;
    return data.toString();
  }
  return String(data);
};
function getChassisIdSubtypeName(subtype) {
  const names = {
    1: "chassisComponent",
    2: "interfaceAlias",
    3: "portComponent",
    4: "macAddress",
    5: "networkAddress",
    6: "interfaceName",
    7: "local"
  };
  return names[subtype] || `unknown (${subtype})`;
}
function getPortIdSubtypeName(subtype) {
  const names = {
    1: "interfaceAlias",
    2: "portComponent",
    3: "macAddress",
    4: "networkAddress",
    5: "interfaceName",
    6: "agentCircuitId",
    7: "local"
  };
  return names[subtype] || `unknown (${subtype})`;
}
var fetchAndProcessLldpData = (ipAddress, community) => {
  const oidRemTable = "1.0.8802.1.1.2.1.4.1";
  const session = $createSession(ipAddress, community);
  return new Promise((resolve, reject) => {
    session.table(oidRemTable, (error, tableData) => {
      if (error) {
        console.error(`[${new Date().toISOString()}] Terjadi kesalahan saat mengambil data lldp table untuk ${ipAddress}:`, error);
        if (error instanceof $RequestTimedOutError) {
          reject(new Error(`SNMP Request Timed Out saat mengambil LLDP neighbors.`));
        } else if (error instanceof $RequestFailedError) {
          reject(new Error(`SNMP Request Failed saat mengambil LLDP neighbors: ${error.message} (Status: ${error.status || "N/A"})`));
        } else {
          reject(new Error(`SNMP Error lainnya saat mengambil LLDP neighbors: ${error.toString()}`));
        }
        return;
      }
      if (!tableData || Object.keys(tableData).length === 0) {
        resolve([]);
        return;
      }
      const processedNeighbors = Object.entries(tableData).map(([compositeIndex, columns]) => {
        const indexParts = compositeIndex.split(".");
        const localPortIfIndex = indexParts.length > 1 ? parseInt(indexParts[1], 10) : null;
        return {
          compositeIndex,
          localPortIfIndex,
          remoteChassisIdSubtypeCode: columns["4"] ? parseInt(safeToString(columns["4"]) || "0", 10) : null,
          remoteChassisIdSubtypeName: columns["4"] ? getChassisIdSubtypeName(parseInt(safeToString(columns["4"]) || "0", 10)) : null,
          remoteChassisId: parseInt(safeToString(columns["4"]) || "0", 10) === 4 ? safeToString(columns["5"], "hex") : safeToString(columns["5"]),
          remotePortIdSubtypeCode: columns["6"] ? parseInt(safeToString(columns["6"]) || "0", 10) : null,
          remotePortIdSubtypeName: columns["6"] ? getPortIdSubtypeName(parseInt(safeToString(columns["6"]) || "0", 10)) : null,
          remotePortId: parseInt(safeToString(columns["6"]) || "0", 10) === 3 ? safeToString(columns["7"], "hex") : safeToString(columns["7"]),
          remotePortDescription: safeToString(columns["8"]),
          remoteSystemName: safeToString(columns["9"]),
          remoteSystemDescription: safeToString(columns["10"])
        };
      });
      resolve(processedNeighbors);
    });
  });
};
var discoverStorageIndices = (ipAddress, community) => {
  return new Promise((resolve) => {
    const session = $createSession(ipAddress, community, {
      timeout: 2000,
      retries: 0
    });
    const storageTypeOid = "1.3.6.1.2.1.25.2.3.1.2";
    const indices = [];
    session.subtree(storageTypeOid, (varbinds) => {
      varbinds.forEach((vb) => {
        const oidParts = vb.oid.split(".");
        const index = parseInt(oidParts[oidParts.length - 1]);
        if (!isNaN(index)) {
          indices.push(index);
        }
      });
    }, (error) => {
      session.close();
      if (error) {
        console.warn(`Storage discovery failed for ${ipAddress}: ${error.message}`);
        resolve([1, 2, 3, 4, 5]);
      } else {
        resolve(indices.length > 0 ? indices : [1, 2, 3, 4, 5]);
      }
    });
  });
};
var SNMP_OIDS = {
  mikrotik: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1"
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.65536"
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.65536"
      ]
    }
  },
  juniper: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1"
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.1"
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.1"
      ]
    }
  },
  huawei: {
    cpu: [
      "1.3.6.1.4.1.2011.6.3.4.1.2.1.1.0"
    ],
    ram: {
      total: [
        "1.3.6.1.4.1.2011.6.3.5.1.1.2.1.1.0",
        "1.3.6.1.4.1.2011.6.3.5.1.1.8.1.1.0"
      ],
      used: [
        "1.3.6.1.4.1.2011.6.3.5.1.1.3.1.1.0"
      ]
    }
  },
  generic: {
    cpu: [
      "1.3.6.1.2.1.25.3.3.1.2.1",
      "1.3.6.1.2.1.25.3.3.1.2.2",
      "1.3.6.1.2.1.25.3.3.1.2.0",
      "1.3.6.1.2.1.25.3.3.1.2"
    ],
    ram: {
      total: [
        "1.3.6.1.2.1.25.2.3.1.5.1",
        "1.3.6.1.2.1.25.2.3.1.5.2",
        "1.3.6.1.2.1.25.2.3.1.5.3",
        "1.3.6.1.2.1.25.2.3.1.5.4",
        "1.3.6.1.2.1.25.2.3.1.5.5",
        "1.3.6.1.2.1.25.2.2.0"
      ],
      used: [
        "1.3.6.1.2.1.25.2.3.1.6.1",
        "1.3.6.1.2.1.25.2.3.1.6.2",
        "1.3.6.1.2.1.25.2.3.1.6.3",
        "1.3.6.1.2.1.25.2.3.1.6.4",
        "1.3.6.1.2.1.25.2.3.1.6.5",
        "1.3.6.1.2.1.25.5.1.1.2.1"
      ]
    }
  }
};
var getDeviceVendor = (os) => {
  if (!os)
    return "generic";
  const osLower = os.toLowerCase();
  if (osLower.includes("mikrotik") || osLower.includes("routeros") || osLower.includes("router os") || osLower.includes("mt")) {
    return "mikrotik";
  }
  if (osLower.includes("junos") || osLower.includes("juniper") || osLower.includes("srx") || osLower.includes("ex") || osLower.includes("mx")) {
    return "juniper";
  }
  if (osLower.includes("huawei") || osLower.includes("vrp") || osLower.includes("versatile routing platform") || osLower.includes("cloudengine") || osLower.includes("ce")) {
    return "huawei";
  }
  if (osLower.includes("cisco") || osLower.includes("ios") || osLower.includes("nexus") || osLower.includes("catalyst")) {
    return "cisco";
  }
  if (osLower.includes("hp ") || osLower.includes("hpe") || osLower.includes("procurve") || osLower.includes("aruba")) {
    return "hp";
  }
  return "generic";
};
var fetchCpuUsage = (ipAddress, community, vendor) => {
  return new Promise((resolve, reject) => {
    const oids = SNMP_OIDS[vendor] || SNMP_OIDS.generic;
    const cpuOids = Array.isArray(oids.cpu) ? oids.cpu : [oids.cpu];
    if (cpuOids.length === 0) {
      return resolve(null);
    }
    console.log(`[OID-TEST] Batch testing ${cpuOids.length} CPU OIDs for ${ipAddress} (vendor: ${vendor})`);
    const session = $createSession(ipAddress, community, {
      timeout: 8000,
      retries: 0,
      version: $Version2c
    });
    session.get(cpuOids, (error, varbinds) => {
      session.close();
      if (error) {
        const errorMessage = `SNMP session error for ${ipAddress}: ${error.message || error}`;
        console.error(`[OID-ERROR] ${errorMessage}`);
        return reject(new Error(errorMessage));
      }
      for (const varbind of varbinds) {
        if ($isVarbindError(varbind)) {
          continue;
        }
        try {
          if (varbind.value !== null && varbind.value !== undefined) {
            let cpuUsage = parseInt(varbind.value.toString());
            const rawValue = cpuUsage;
            const oid = varbind.oid;
            if (vendor === "juniper") {
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            } else if (vendor === "mikrotik") {
              if (oid.includes("14988.1.1.3.14")) {
                cpuUsage = Math.min(100, Math.max(0, Math.round(cpuUsage * 100 / 255)));
                console.log(`[DEBUG] MikroTik ${ipAddress} - Converted CPU from 0-255 scale: ${rawValue} -> ${cpuUsage}%`);
              } else if (oid.includes("1.3.6.1.2.1.25.3.3.1.2")) {
                if (cpuUsage > 100) {
                  cpuUsage = Math.min(100, Math.max(0, cpuUsage / 100));
                  console.log(`[DEBUG] MikroTik ${ipAddress} - Scaled CPU from centipercent: ${rawValue} -> ${cpuUsage}%`);
                } else {
                  cpuUsage = Math.min(100, Math.max(0, cpuUsage));
                }
              } else {
                cpuUsage = Math.min(100, Math.max(0, cpuUsage));
              }
            } else {
              cpuUsage = Math.min(100, Math.max(0, cpuUsage));
            }
            console.log(`[OID-SUCCESS] CPU OID SUCCESSFUL: ${oid} for ${ipAddress} (vendor: ${vendor}) - Result: ${cpuUsage}%`);
            return resolve(cpuUsage);
          }
        } catch (parseError) {}
      }
      console.error(`[OID-SUMMARY] ALL CPU OIDs FAILED for ${ipAddress} (vendor: ${vendor})`);
      resolve(null);
    });
  });
};
var fetchRamUsage = (ipAddress, community, vendor) => {
  return new Promise(async (resolve, reject) => {
    const oids = SNMP_OIDS[vendor] || SNMP_OIDS.generic;
    let totalOids = Array.isArray(oids.ram.total) ? oids.ram.total : [oids.ram.total];
    let usedOids = Array.isArray(oids.ram.used) ? oids.ram.used : [oids.ram.used];
    if (vendor === "generic") {
      try {
        const indices = await discoverStorageIndices(ipAddress, community);
        const dynamicTotalOids = indices.map((idx) => `1.3.6.1.2.1.25.2.3.1.5.${idx}`);
        const dynamicUsedOids = indices.map((idx) => `1.3.6.1.2.1.25.2.3.1.6.${idx}`);
        totalOids = [...totalOids, ...dynamicTotalOids];
        usedOids = [...usedOids, ...dynamicUsedOids];
      } catch (error) {
        console.warn(`[OID-INFO] Storage discovery failed for ${ipAddress}, using static OIDs.`);
      }
    }
    const allOids = [...new Set([...totalOids, ...usedOids])];
    if (allOids.length === 0) {
      return resolve(null);
    }
    console.log(`[OID-TEST] \u26A1\uFE0F Batch testing ${allOids.length} RAM OIDs for ${ipAddress} (vendor: ${vendor})`);
    const session = $createSession(ipAddress, community, {
      timeout: 8000,
      retries: 0,
      version: $Version2c
    });
    session.get(allOids, (error, varbinds) => {
      session.close();
      if (error) {
        const errorMessage = `SNMP session error for ${ipAddress}: ${error.message || error}`;
        console.error(`[OID-ERROR] ${errorMessage}`);
        return reject(new Error(errorMessage));
      }
      const resultMap = new Map;
      for (const varbind of varbinds) {
        if (!$isVarbindError(varbind) && varbind.value !== null && varbind.value !== undefined) {
          try {
            resultMap.set(varbind.oid, parseInt(varbind.value.toString()));
          } catch (e) {}
        }
      }
      if (resultMap.size === 0) {
        console.error(`[OID-SUMMARY] No valid RAM OIDs returned for ${ipAddress}`);
        return resolve(null);
      }
      for (const totalOid of totalOids) {
        for (const usedOid of usedOids) {
          if (resultMap.has(totalOid) && resultMap.has(usedOid)) {
            let totalRam = resultMap.get(totalOid);
            let usedRam = resultMap.get(usedOid);
            if (vendor === "mikrotik") {
              if (usedOid.includes("14988.1.1.1.1")) {
                usedRam = totalRam - usedRam;
              }
              if (totalRam < 1024) {
                totalRam *= 1024 * 1024;
                usedRam *= 1024 * 1024;
              }
            }
            if (totalRam > 0) {
              const ramUsagePercent = usedRam / totalRam * 100;
              const finalUsage = Math.min(100, Math.max(0, Math.round(ramUsagePercent * 100) / 100));
              console.log(`[OID-SUCCESS] RAM OIDs SUCCESSFUL: Total=${totalOid}, Used=${usedOid} for ${ipAddress} - Result: ${finalUsage}%`);
              return resolve(finalUsage);
            }
          }
        }
      }
      console.error(`[OID-SUMMARY] Could not find a working RAM OID pair for ${ipAddress}`);
      resolve(null);
    });
  });
};
var fetchSystemUsage = async (ipAddress, community, vendor) => {
  console.log(`[SYSTEM-USAGE] Starting system usage monitoring for ${ipAddress} (vendor: ${vendor})`);
  try {
    const cpuUsage = await fetchCpuUsage(ipAddress, community, vendor);
    const ramUsage = await fetchRamUsage(ipAddress, community, vendor);
    console.log(`[SYSTEM-USAGE] Completed system usage monitoring for ${ipAddress} (vendor: ${vendor}) - CPU: ${cpuUsage}%, RAM: ${ramUsage}%`);
    return { cpuUsage, ramUsage };
  } catch (error) {
    console.error(`[SYSTEM-USAGE] \u274C Error fetching system usage for ${ipAddress} (vendor: ${vendor}):`, error);
    return { cpuUsage: null, ramUsage: null };
  }
};
var testSNMPConnectivity = async (ipAddress, community) => {
  console.log(`[SNMP-TEST] Testing basic SNMP connectivity for ${ipAddress}`);
  const results = {
    connectivity: false,
    supportedVersions: [],
    systemInfo: undefined,
    error: undefined
  };
  try {
    const sessionV1 = $createSession(ipAddress, community, {
      version: $Version1,
      timeout: 3000,
      retries: 0
    });
    const sysDescrOid = "1.3.6.1.2.1.1.1.0";
    const testResult = await new Promise((resolve, reject) => {
      sessionV1.get([sysDescrOid], (error, varbinds) => {
        sessionV1.close();
        if (error) {
          reject(error);
        } else if (varbinds && varbinds.length > 0 && varbinds[0].value) {
          resolve(varbinds[0].value.toString());
        } else {
          reject(new Error("No response"));
        }
      });
    });
    results.supportedVersions.push("SNMPv1");
    results.connectivity = true;
    results.systemInfo = { sysDescr: testResult };
    console.log(`[SNMP-TEST] SNMPv1 works: ${testResult}`);
  } catch (error) {
    console.log(`[SNMP-TEST] \u274C SNMPv1 failed: ${error.message}`);
  }
  try {
    const sessionV2c = $createSession(ipAddress, community, {
      version: $Version2c,
      timeout: 3000,
      retries: 0
    });
    const sysDescrOid = "1.3.6.1.2.1.1.1.0";
    const testResult = await new Promise((resolve, reject) => {
      sessionV2c.get([sysDescrOid], (error, varbinds) => {
        sessionV2c.close();
        if (error) {
          reject(error);
        } else if (varbinds && varbinds.length > 0 && varbinds[0].value) {
          resolve(varbinds[0].value.toString());
        } else {
          reject(new Error("No response"));
        }
      });
    });
    results.supportedVersions.push("SNMPv2c");
    results.connectivity = true;
    if (!results.systemInfo) {
      results.systemInfo = { sysDescr: testResult };
    }
    console.log(`[SNMP-TEST] SNMPv2c works: ${testResult}`);
  } catch (error) {
    console.log(`[SNMP-TEST] \u274C SNMPv2c failed: ${error.message}`);
  }
  if (!results.connectivity) {
    results.error = "No SNMP connectivity detected with either v1 or v2c";
  }
  return results;
};
var discoverAvailableOids = async (ipAddress, community) => {
  console.log(`[OID-DISCOVERY] Discovering available OIDs for ${ipAddress}`);
  const session = $createSession(ipAddress, community, {
    version: $Version2c,
    timeout: 5000,
    retries: 0
  });
  const availableOids = [];
  return new Promise((resolve) => {
    session.walk("1.3.6.1.4.1.2011", (varbinds) => {
      varbinds.forEach((varbind) => {
        availableOids.push(varbind.oid);
        if (availableOids.length % 100 === 0) {
          console.log(`[OID-DISCOVERY] Found ${availableOids.length} OIDs so far...`);
        }
      });
    }, (error) => {
      session.close();
      if (error) {
        console.log(`[OID-DISCOVERY] Walk completed with error: ${error.message}`);
      } else {
        console.log(`[OID-DISCOVERY] Walk completed. Found ${availableOids.length} OIDs`);
      }
      resolve(availableOids);
    });
    setTimeout(() => {
      session.close();
      console.log(`[OID-DISCOVERY] Discovery timeout. Found ${availableOids.length} OIDs`);
      resolve(availableOids);
    }, 30000);
  });
};
var getMikroTikInterfaceName = (portNumber, interfaceNames) => {
  const portToInterfaceMap = {
    0: 6,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 5
  };
  const interfaceIndex = portToInterfaceMap[portNumber];
  if (interfaceIndex && interfaceNames.has(interfaceIndex)) {
    return interfaceNames.get(interfaceIndex);
  }
  if (interfaceNames.has(portNumber)) {
    return interfaceNames.get(portNumber);
  }
  return `port-${portNumber}`;
};
var fetchRouterOSVlans = (ipAddress, community, dbInterfaces) => {
  console.log(`[ROUTEROS-VLAN] Fetching VLAN data for ${ipAddress}`);
  return new Promise(async (resolve, reject) => {
    const session = $createSession(ipAddress, community, {
      version: $Version2c,
      timeout: 12000,
      retries: 1
    });
    const timeoutId = setTimeout(() => {
      session.close();
      console.warn(`[ROUTEROS-VLAN] Timeout fetching VLAN data from ${ipAddress}`);
      resolve([]);
    }, 18000);
    const vlanData = [];
    const interfaceNames = new Map;
    const bridgePortTable = new Map;
    try {
      console.log(`[ROUTEROS-VLAN] Step 1: Getting interface names for ${ipAddress}`);
      await new Promise((resolveWalk) => {
        session.table("1.3.6.1.2.1.2.2.1", (error, tableData) => {
          if (error) {
            console.warn(`[ROUTEROS-VLAN] Interface table error: ${error.message}`);
          } else if (tableData) {
            Object.entries(tableData).forEach(([index, columns]) => {
              const ifIndex = parseInt(index);
              const ifName = safeToString(columns["2"]);
              const ifDescr = safeToString(columns["3"]);
              if (ifName) {
                interfaceNames.set(ifIndex, ifName);
              } else if (ifDescr) {
                interfaceNames.set(ifIndex, ifDescr);
              }
            });
          }
          resolveWalk();
        });
      });
      console.log(`[ROUTEROS-VLAN] Found ${interfaceNames.size} interfaces`);
      console.log(`[ROUTEROS-VLAN] Interface mapping:`, Object.fromEntries(interfaceNames));
      console.log(`[ROUTEROS-VLAN] Step 2: Getting MikroTik VLAN data using specific table`);
      await new Promise((resolveWalk) => {
        session.table("1.3.6.1.2.1.17.7.1.2.2.1", (error, tableData) => {
          if (error) {
            console.warn(`[ROUTEROS-VLAN] MikroTik VLAN table error: ${error.message}`);
          } else if (tableData && Object.keys(tableData).length > 0) {
            console.log(`[ROUTEROS-VLAN] Found ${Object.keys(tableData).length} VLAN entries`);
            const parsedVlans = parseMikroTikVlanTableDynamic(tableData, interfaceNames, dbInterfaces);
            vlanData.push(...parsedVlans);
            console.log(`[ROUTEROS-VLAN] Parsed ${parsedVlans.length} VLANs from MikroTik table`);
          } else {
            console.log(`[ROUTEROS-VLAN] MikroTik VLAN table returned no data`);
          }
          resolveWalk();
        });
      });
      if (vlanData.length === 0) {
        console.log(`[ROUTEROS-VLAN] Step 4: Trying Bridge VLAN Static Table`);
        await new Promise((resolveWalk) => {
          session.table("1.3.6.1.2.1.17.7.1.4.5.1", (error, tableData) => {
            if (error) {
              console.warn(`[ROUTEROS-VLAN] Bridge VLAN Static error: ${error.message}`);
            } else if (tableData && Object.keys(tableData).length > 0) {
              const parsedVlans = parseBridgeVlanStaticTableMikroTik(tableData, interfaceNames);
              vlanData.push(...parsedVlans);
              console.log(`[ROUTEROS-VLAN] Bridge VLAN Static found ${parsedVlans.length} VLANs`);
            }
            resolveWalk();
          });
        });
      }
      console.log(`[ROUTEROS-VLAN] Successfully found ${vlanData.length} VLAN entries for ${ipAddress}`);
      vlanData.forEach((vlan) => {
        console.log(`[ROUTEROS-VLAN] \u2705 VLAN ${vlan.vlanId}: Tagged=[${vlan.taggedPorts}], Untagged=[${vlan.untaggedPorts}]`);
      });
      clearTimeout(timeoutId);
      session.close();
      resolve(vlanData);
    } catch (mainError) {
      console.error(`[ROUTEROS-VLAN] Main error for ${ipAddress}:`, mainError);
      clearTimeout(timeoutId);
      session.close();
      resolve([]);
    }
    session.on("error", (err) => {
      clearTimeout(timeoutId);
      console.warn(`[ROUTEROS-VLAN] Session error for ${ipAddress}: ${err.message || err}`);
      session.close();
      resolve([]);
    });
  });
};
var parseMikroTikVlanTableDynamic = (tableData, interfaceNames, dbInterfaces) => {
  const vlanMap = new Map;
  const macToInterface = new Map;
  if (dbInterfaces) {
    dbInterfaces.forEach((iface) => {
      if (iface.ifPhysAddress) {
        const cleanMac = iface.ifPhysAddress.toLowerCase().replace(/[:-]/g, "");
        const formattedMac = cleanMac.match(/.{2}/g)?.join(":");
        if (formattedMac && iface.ifName) {
          macToInterface.set(formattedMac, iface.ifName);
        }
      }
    });
  }
  console.log(`[ROUTEROS-VLAN] Processing ${Object.keys(tableData).length} VLAN entries dynamically`);
  Object.entries(tableData).forEach(([macAddress, columns]) => {
    try {
      Object.keys(columns).forEach((vlanIdStr) => {
        const vlanId = parseInt(vlanIdStr);
        if (!isNaN(vlanId) && vlanId > 0 && vlanId !== 1 && vlanId !== 99) {
          if (!vlanMap.has(vlanId)) {
            vlanMap.set(vlanId, new Set);
          }
          const macHex = safeToString(columns[vlanIdStr], "hex");
          let interfaceName = null;
          if (macHex && macToInterface.has(macHex)) {
            interfaceName = macToInterface.get(macHex);
          }
          if (!interfaceName) {
            const indexMac = macAddress.split(".").map((part) => parseInt(part).toString(16).padStart(2, "0")).join(":");
            if (macToInterface.has(indexMac)) {
              interfaceName = macToInterface.get(indexMac);
            }
          }
          if (!interfaceName) {
            for (const [ifIndex, ifName] of interfaceNames.entries()) {
              if (ifName && (ifName.includes("sfp") || ifName.includes("ether") || ifName.includes("bridge"))) {
                vlanMap.get(vlanId).add(ifName);
              }
            }
          } else {
            vlanMap.get(vlanId).add(interfaceName);
          }
        }
      });
    } catch (error) {
      console.warn(`[ROUTEROS-VLAN] Error parsing VLAN entry ${macAddress}:`, error);
    }
  });
  const vlans = [];
  vlanMap.forEach((interfaces, vlanId) => {
    if (interfaces.size > 0) {
      const interfaceList = Array.from(interfaces);
      vlans.push({
        vlanId,
        name: `VLAN-${vlanId}`,
        description: `VLAN ${vlanId}`,
        taggedPorts: interfaceList.join(","),
        untaggedPorts: "",
        tableUsed: "Dynamic SNMP Analysis"
      });
      console.log(`[ROUTEROS-VLAN] VLAN ${vlanId}: interfaces [${interfaceList.join(", ")}]`);
    }
  });
  return vlans;
};
var parseBridgeVlanStaticTableMikroTik = (tableData, interfaceNames) => {
  const vlans = [];
  const vlanEntries = new Map;
  Object.entries(tableData).forEach(([index, columns]) => {
    try {
      const entryIndex = parseInt(index);
      if (!isNaN(entryIndex)) {
        const vlanId = parseInt(safeToString(columns["1"]) || "0");
        const portType = parseInt(safeToString(columns["2"]) || "0");
        const status = parseInt(safeToString(columns["3"]) || "0");
        if (vlanId > 0 && status === 1) {
          const entryKey = `${vlanId}`;
          if (!vlanEntries.has(entryKey)) {
            vlanEntries.set(entryKey, {
              vlanId,
              taggedPorts: new Set,
              untaggedPorts: new Set
            });
          }
          const vlan = vlanEntries.get(entryKey);
          const interfaceName = getMikroTikInterfaceName(entryIndex - 1, interfaceNames);
          if (portType === 1) {
            vlan.untaggedPorts.add(interfaceName);
          } else if (portType === 2) {
            vlan.taggedPorts.add(interfaceName);
          }
        }
      }
    } catch (error) {
      console.warn(`[ROUTEROS-VLAN] Error parsing bridge static entry ${index}:`, error);
    }
  });
  vlanEntries.forEach((vlan, vlanId) => {
    if (vlan.taggedPorts.size > 0 || vlan.untaggedPorts.size > 0) {
      vlans.push({
        vlanId: vlan.vlanId,
        name: `VLAN-${vlan.vlanId}`,
        description: `VLAN ${vlan.vlanId}`,
        taggedPorts: Array.from(vlan.taggedPorts).join(","),
        untaggedPorts: Array.from(vlan.untaggedPorts).join(","),
        tableUsed: "Bridge VLAN Static Table (MikroTik)"
      });
    }
  });
  return vlans;
};
var updateSnmpCommunity = () => {
  return "laros999";
};
var testRouterOSVlansSync = async (ipAddress, community) => {
  console.log(`[VLAN-TEST] Starting VLAN test for ${ipAddress}`);
  try {
    const vlanData = await fetchRouterOSVlans(ipAddress, community);
    if (vlanData.length === 0) {
      return {
        success: false,
        message: `No VLAN data found for ${ipAddress}. Device may not have VLANs configured or SNMP access issues.`
      };
    }
    console.log(`[VLAN-TEST] Successfully parsed ${vlanData.length} VLANs from ${ipAddress}`);
    vlanData.forEach((vlan) => {
      console.log(`[VLAN-TEST] VLAN ${vlan.vlanId}: Tagged=[${vlan.taggedPorts}], Untagged=[${vlan.untaggedPorts}]`);
    });
    return {
      success: true,
      message: `Successfully parsed ${vlanData.length} VLANs`,
      data: vlanData
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[VLAN-TEST] Test failed for ${ipAddress}: ${errorMessage}`);
    return {
      success: false,
      message: `VLAN test failed: ${errorMessage}`
    };
  }
};
export {
  updateSnmpCommunity,
  testSNMPConnectivity,
  testRouterOSVlansSync,
  getDeviceVendor,
  fetchSystemUsage,
  fetchRouterOSVlans,
  fetchRamUsage,
  fetchCpuUsage,
  fetchAndProcessLldpData,
  discoverAvailableOids
};
