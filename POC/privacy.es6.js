'use strict';

var Privacy = (() => {
    const IS_PROXY = Symbol("IS_PROXY");
    const IS_PV = Symbol("IS_PV");
    const DATA = Symbol("DATA");
    const CONTEXT = Symbol("CONTEXT");
    const SUPER = Symbol("SUPER");

    if (Error.prepareStackTrace) {
        function prepareStackTrace(err, trace) {
            var retval;

            err.stackTrace = trace;
            if (typeof(prepareStackTrace.original) == "function")
                retval = prepareStackTrace.original(err, trace);

            return retval;
        }

        prepareStackTrace.original = Error.prepareStackTrace.bind(Error);
        Error.prepareStackTrace = prepareStackTrace;
    }

    function proxyCheck(obj) { //Necessary since prototypes report as well...
        'use strict';
        var proto = Object.getPrototypeOf(obj);
        Object.setPrototypeOf(obj, null);
        var retval = obj[IS_PROXY];
        Object.setPrototypeOf(obj, proto);
        return retval;
    }

    var handler = {
        slots: new WeakMap(),
        stack: [],
        getCallerDI() {
            //This only exists because Function.caller has been deprecated.
            //It's only approximate and can be spoofed under the right conditions.
            var retval;
            if (this.stack.length) {
                let err = new Error();
                let currentFn = this.stack[this.stack.length-1];
                let cfnPvt = this.slots.get(currentFn); 
                if (err.stackTrace) {
                    let frame = err.stackTrace[3];
                    let frameFn = (frame) ? frame.getFunction() : undefined;
                    if (((typeof(frameFn) == "function") && (frameFn === currentFn)) || 
                        (frame.getFunctionName() == currentFn.name) ||
                        ((currentFn.name.length === 0) && /<anonymous>/.test(frame.getFunctionName()))) {
                        retval = cfnPvt.DeclarationInfo;
                    }
                }
                else {
                    let eStack = (new Error()).stack.split('\n');
                    let regex = new RegExp(`${currentFn.name || "<anonymous>"}`);
                    if (regex.test(eStack[4]))
                        retval = cfnPvt.DeclarationInfo;
                }
            }
            return retval;
        },
        canAccess(target) {
            if (!this.slots.has(target)) {
                throw new TypeError('Cannot access non-existent private key');
            }
            let pi = this.slots.get(target);
            let diList = pi.DeclarationInfo;
            let methodDI = this.getCallerDI();
            let exists = 0;

            if (methodDI) {
                for (let di of diList) {
                    let thisDI = methodDI.find((value) => {
                        return (value === di) || (value.isPrototypeOf(di)) || (di.isPrototypeOf(value));
                    });
                    if (thisDI)
                        ++exists;
                }
            }

            return !!exists;
        },
        getPrivateValue(target, key) {
            let pvtKey = undefined;
            let diList = target.DeclarationInfo;
            let thisDI = undefined;
            let thisPV = target.PrivateValues;
            let methodDI = this.getCallerDI();

            if (methodDI) {
                for (let di of diList) {
                    thisDI = methodDI.find((value) => {
                        return (value === di) || (value.isPrototypeOf(di)) || (di.isPrototypeOf(value));
                    });
                    if (thisDI && (key in thisDI))
                        break;
                    else
                        thisDI = undefined;
                }
            }

            if (!thisDI) {
                throw new TypeError(`Current method does not have access to private members of ${target.className}`);
            }

            pvtKey = thisDI[key];

            if (!(pvtKey in thisPV))
                throw new ReferenceError(`Cannot access non-existent private key ${key}`);

            return thisPV[pvtKey];
        },
        setPrivateValue(target, key, value) {
            let pvtKey = undefined;
            let diList = target.DeclarationInfo;
            let thisDI = undefined;
            let thisPV = target.PrivateValues;
            let methodDI = this.getCallerDI();

            if (methodDI) {
                for (let di of diList) {
                    thisDI = methodDI.find((value) => {
                        return (value === di) || (value.isPrototypeOf(di)) || (di.isPrototypeOf(value));
                    });
                    if (thisDI && (key in thisDI))
                        break;
                    else
                        thisDI = undefined;
                }
            }

            if (!thisDI) {
                throw new TypeError(`Current method does not have access to private members of ${target.className}`);
            }

            pvtKey = thisDI[key];

            if (!(pvtKey in thisPV))
                throw new ReferenceError(`Cannot access non-existent private key ${key}`);
            
            thisPV[pvtKey] = value;
        },
        get(target, key, receiver) {
            var retval;
            var opTarget = (target[SUPER]) ? target: receiver;
            if (key === IS_PROXY) {
                retval = this.slots.has(receiver);
            }
            else if (key === CONTEXT) {
                retval = target[CONTEXT];
            }
            else if (key === '#') {
                if (this.canAccess(opTarget)) {
                    retval = new Proxy({ [CONTEXT]: receiver, __proto__: this.slots.get(opTarget) }, this);
                }
                else {
                    throw new ReferenceError(`Cannot access private data from invalid scope.`);
                }
            }
            else if (target[IS_PV] && (key !== IS_PV)) {
                retval = this.getPrivateValue(target, key);
            }
            else {
                retval = Reflect.get(target, key, receiver);
            }

            if ((key === "toString") && (retval === Function.prototype.toString))
                retval = retval.bind(target);

            return retval;
        },
        set(target, key, value, receiver) {
            (target[IS_PV]) ? this.setPrivateValue(target, key, value) : Reflect.set(target, key, value, receiver);
            return true;
        },
        stageInstance(instance) {
            var proto = Object.getPrototypeOf(instance);
            var pv = this.slots.get(proto);
            if (!this.slots.has(instance)) {
                this.slots.set(instance, {
                    [IS_PV]: true,
                    PrivateValues: Object.create(pv.PrivateValues),
                    DeclarationInfo: [pv.DeclarationInfo[0]]
                });
            }
            else {
                let rpv = this.slots.get(instance);
                if (!pv.PrivateValues.isPrototypeOf(rpv.PrivateValues))
                    Object.setPrototypeOf(rpv.PrivateValues, pv.PrivateValues);
                if (pv.DeclarationInfo[0] !== rpv.DeclarationInfo[0])
                    rpv.DeclarationInfo[0] = pv.DeclarationInfo[0];
            }
        },
        construct(target, args, newTarget) {
            this.stack.push(target);
            var retval = Reflect.construct(target, args, newTarget);
            if (!proxyCheck(retval)) {
                retval = new Proxy(retval, this);
            }
            var proto = Object.getPrototypeOf(retval);
            if (!this.slots.has(proto)) {
                throw new TypeError(`Constructor ${target.name || "anonymous"} must be wrapped with Class.wrap()`);
            }
            this.stageInstance(retval);

            this.stack.pop();
            return retval;
        },
        apply(target, context, args) {
            this.stack.push(target);
            var pContext = (!context) ? context : (context[IS_PV])? context[CONTEXT] : (proxyCheck(context)) ? context : new Proxy(context, handler);
            var retval = Reflect.apply(target, pContext, args);
            this.stack.pop();
            return retval;
        },
        deleteProperty(target, key) {
            var retval = false;
            if (!target[IS_PV])
                retval = Reflect.deleteProperty(target, key);
            return retval;
        }
    };

    function getFieldDef(ctorData, field) {
        var def = Object.getOwnPropertyDescriptor(ctorData, field);
        if ("value" in def)
            def.writable = true;

        if (typeof(field) !== "symbol") {
            let parts = field.split(' ');
            field = parts.pop();
            for (let part of parts) {
                switch (part) {
                    case "private":
                        def.private = true;
                        break;
                    case "protected":
                        def.private = true;
                        def.shared = true;
                        break;
                    case "static":
                        def.static = true;
                        break;
                    case "const":
                    case "final":
                        def.writable = false;
                        break;
                }
            }
        }

        return {field, def};
    }

    function inheritDeclarations(list) {
        var retval = [];

        for (let item of list) {
            retval.push(Object.create(item));
        }

        if (!retval.length) {
            retval.push({});
        }

        return retval;
    }

    var retval = function Privacy(obj) {
        var isFn = typeof(obj) == "function";
        var hasCtor = (!isFn && obj.hasOwnProperty("constructor"));

        //Make sure that if we got a non-function, it's set up right...
        if (!isFn) {
            //let oProto = Object.getPrototypeOf(obj);
            // if (!proxyCheck(oProto))
            //     Object.setPrototypeOf(obj, Privacy.wrap(oProto));
            if (hasCtor) {
                if (obj.constructor.prototype !== obj) {
                    obj.constructor.prototype = obj;
                }
                obj = obj.constructor;
            }
        }

        var ctor = (isFn) ? obj : (hasCtor) ? obj.constructor : null;
        var ctorData = (ctor) ? (DATA in ctor) ? ctor[DATA]() : (isFn) ? {} : obj : obj;
        var proto = (isFn) ? ctor.prototype : obj;
        var sProto = (ctor) ? Object.getPrototypeOf(ctor.prototype) : Object.getPrototypeOf(proto);
        var parent = (sProto) ? (ctor) ? sProto.constructor : (proxyCheck(sProto)) ? sProto : null : null;
        var parentStaticSlot = (ctor) ? (parent) ? handler.slots.get(parent) : {} : {};
        var parentPrivateSlot = (parent) ? handler.slots.get((ctor) ? parent.prototype : parent) : {};
        var staticSlot = { [IS_PV]: true, className: (ctor) ? ctor.name || "<anonymous>" : "<anonymous>",
                           PrivateValues: { __proto__: parentStaticSlot.PrivateValues || Object.prototype },
                           DeclarationInfo: inheritDeclarations(parentStaticSlot.DeclarationInfo || []),
                           InheritanceInfo: { __proto__: parentStaticSlot.InheritanceInfo || Object.prototype } };
        var privateSlot = { [IS_PV]: true, className: (ctor) ? ctor.name || "<anonymous>" : "<anonymous>",
                            PrivateValues: { __proto__: parentPrivateSlot.PrivateValues || Object.prototype },
                            DeclarationInfo: inheritDeclarations(parentPrivateSlot.DeclarationInfo || []), 
                            InheritanceInfo: { __proto__: parentPrivateSlot.InheritanceInfo || Object.prototype } };
        var cdProto = { [SUPER]: true };
        var pcdProto = new Proxy(cdProto, handler);
                            
        //Set the private data for the constructor and prototype
        var ctorDataKeys = Object.getOwnPropertyNames(ctorData).concat(Object.getOwnPropertySymbols(ctorData));
        for (let fieldName of ctorDataKeys) {
            let {field, def} = getFieldDef(ctorData, fieldName);
            let isStatic = def.static;
            let slot = (isStatic) ? staticSlot : privateSlot;
            if (def.private) {
                let fieldSymbol = Symbol(field.toString());
                Object.defineProperty(slot.DeclarationInfo[0], field, {
                    configurable: true,
                    value: fieldSymbol
                });
                Object.defineProperty(slot.PrivateValues, fieldSymbol, def);
                if (!!def.shared)
                    slot.InheritanceInfo[field] = fieldSymbol;
                if (!isFn)
                    delete ctorData[fieldName];
            }
            else {
                let target = (isStatic) ? ctor : proto;
                Object.defineProperty(target, field, def);
            }
        }

        if (ctor)
            handler.slots.set(ctor, staticSlot);
        handler.slots.set(proto, privateSlot);
        if (parentPrivateSlot) {
            handler.slots.set(cdProto, parentPrivateSlot);
            handler.slots.set(pcdProto, parentPrivateSlot);
        }
        if (ctor && (DATA in ctor))
            Object.setPrototypeOf(ctorData, pcdProto);

        //Modify all functions of the class into proxies and add the appropriate definitions.
        var info = [privateSlot.DeclarationInfo[0], staticSlot.DeclarationInfo[0]];
        for (let data of [privateSlot.PrivateValues, staticSlot.PrivateValues, proto]) {
            let keys = Object.getOwnPropertyNames(data).concat(Object.getOwnPropertySymbols(data));
            for (let key of keys) {
                let def = Object.getOwnPropertyDescriptor(data, key);
                let changed = false;

                for (let prop of ["value", "get", "set"]) {
                    if (typeof(def[prop]) == "function") {
                        let p = def[prop];
                        changed = true;
                        if (key == "constructor") {
                            def[prop] = new Proxy(p, handler);
                            let ctorSlot = handler.slots.get(p);
                            handler.slots.set(def[prop], ctorSlot);
                            ctorSlot.DeclarationInfo.push(privateSlot.DeclarationInfo[0]);
                        }
                        else {
                            def[prop] = new Proxy(p, handler);
                            let fnSlot = {
                                [IS_PV]: true,
                                className: (isFn) ? obj.name : "Object",
                                DeclarationInfo: info
                            };
                            handler.slots.set(def[prop], fnSlot);
                            handler.slots.set(p, fnSlot);
                        }
                    }
                }

                if (changed) {
                    Object.defineProperty(data, key, def);
                }
            }
        }

        if (ctor && (DATA in ctor))
            delete ctor[DATA];

        for (let di of staticSlot.DeclarationInfo)
            Object.preventExtensions(di);
        Object.preventExtensions(staticSlot.InheritanceInfo);
        for (let di of privateSlot.DeclarationInfo)
            Object.preventExtensions(di);
        Object.preventExtensions(privateSlot.InheritanceInfo);
        
        var retval = (ctor) ? proto.constructor || new Proxy(ctor, handler) : new Proxy(proto, handler);
        if (!ctor) {
            handler.slots.set(retval, privateSlot);
        }
        return retval;
    };

    Object.defineProperties(retval, {
        "DATA": { value: DATA },
        wrap: {
            value: function wrap(obj) {
                var pv = (arguments[1] && handler.canAccess(arguments[1])) ? handler.slots.get(arguments[1]) : null;

                if (typeof(obj) != "function")
                    throw new TypeError("Cannot wrap non-function for inheritance.");

                if (!handler.slots.has(obj))
                    handler.slots.set(obj, { PrivateValues: (pv) ? pv.PrivateValues : Object.prototype, 
                                             DeclarationInfo: (pv) ? pv.DeclarationInfo : [Object.prototype],
                                             InheritanceInfo: (pv) ? pv.InheritanceInfo : Object.prototype });
                if (!pv && obj.prototype && !handler.slots.has(obj.prototype))
                    handler.slots.set(obj.prototype, { PrivateValues: Object.prototype, 
                                                       DeclarationInfo: [Object.prototype],
                                                       InheritanceInfo: Object.prototype });
                
                var retval = (proxyCheck(obj)) ? obj : new Proxy(obj, handler);
                return retval;
            }
        }
    });

    return retval;
})();

module.exports = Privacy;
