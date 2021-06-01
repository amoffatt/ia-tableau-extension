/**
 * ©2021 Virtual Cove, Inc. d/b/a Immersion Analytics. All Rights Reserved. Patented.
 */


window.IA = {
    CreateClient : function()
    {
        let client = this.__internal.wrapNetObjectResult(DotNet.invokeMethod("IARuntime_BlazorJS", "GetClientReference"));

        // Add a model factory property to client
        let modelFactory = client['create'] = {}

        let modelTypes = client.GetConstructableModelTypes();

        for (var i in modelTypes)
        {
            let modelType = modelTypes[i];
            let typeId = modelType.typeId;  // for closure

            // Create a factory function for each model type
            modelFactory[modelType.typeName] = function(...arguments) {
                return client.Create(typeId, arguments);
            }
        }

        return client;
    },

    OnReady : function(callback)
    {
        if (this.__internal.isRuntimeReady)
            setTimeout(callback, 0);
        else
            this.__internal.onReadyCallbacks.push(callback);
    }

}

IA.util = {
    iacolor_to_css(iacolor) {
        return 'rgba(' + [iacolor.rByte, iacolor.gByte, iacolor.bByte, iacolor.aByte/255.0].join(',') + ')'
    }
}



IA.__internal = {
    onReadyCallbacks : Array(),
    isRuntimeReady : false,

    eventCallbacks : {},
    pendingCallbacksToFire : {},
    
    eventLoopDelay : 100,
    
    // Fire event listener in special event loop to avoid lost error messages and exception logs.
    // .Net=>JS interop via IJSRuntime.InvokeAsync()
    // breaks setTimeout() and exception logging within .Net routines executed in the callback
    runEventLoop()
    {
        for (var callbackId in this.pendingCallbacksToFire)
        {
            let callback = this.eventCallbacks[callbackId];
            if (!callback)
            {
                // console.error("No listener for event ID " + callbackId);
                continue;
            }
            
            let arguments = this.pendingCallbacksToFire[callbackId];
            
            setTimeout(() => callback(...arguments), 0);
            
            delete this.pendingCallbacksToFire[callbackId];
        }
        
        this.eventCallbacks['ready'] = () => this.fireRuntimeReadyImpl();
        
        setTimeout(function() { IA.__internal.runEventLoop() }, this.eventLoopDelay);
    },

    // invoked from DotNet
    fireEvent(callbackId, arguments)
    {
        // console.log("Firing Runtime event for listener " + callbackId);
        
        this.argumentsToJs(arguments);
        
        // Related to this function being invoked from .Net via IJSRuntime.InvokeVoidAsync()
        this.pendingCallbacksToFire[callbackId] = arguments;
    },

    // invoked from DotNet
    fireRuntimeReady()
    {
        // needs to fire on event loop to avoid webassembly IJSRuntime.InvokeAsync() issues
        this.fireEvent('ready', []);
    },
    
    // invoked from event loop
    fireRuntimeReadyImpl()
    {
        this.isRuntimeReady = true;
        for (let i in this.onReadyCallbacks)
        {
            let callback = this.onReadyCallbacks[i];
            setTimeout(callback);
        }
    },

    // TODO Use DotNet.attachReviver?
    wrapNetObjectResult(o) {
        if (o && o.invokeMethodAsync)
            return new JSNetObjectWrapper(o);
        return o;
    },

    argumentsToJs(arguments)
    {
        for (let i=0; i<arguments.length; i++)
        {
            arguments[i] = this.wrapNetObjectResult(arguments[i]);
        }
    },

    argumentsToDotNet(arguments)
    {
        for (let i=0; i<arguments.length; i++)
        {
            let o = arguments[i];

            // convert runtime object references into their ID
            if (o && o._netWrapper)
                arguments[i] = { __RuntimeObjectId : o.__RuntimeObjectId }
        }
    },

}

IA.__internal.runEventLoop();


class JSNetObjectWrapper
{
    constructor(netWrapper) {
        this._netWrapper = netWrapper;
        this._methods = netWrapper.invokeMethod("GetMethods");
        this._properties = netWrapper.invokeMethod("GetProperties");
        this._events = netWrapper.invokeMethod("GetEvents");
        this._supportsIndexRead = this._methods.includes("get_Item");
        this._supportsIndexWrite = this._methods.includes("set_Item");

        return new Proxy(this, {
            get(target, name)
            {
                // first check if target already has a field of this name
                let e = target[name];
                if (typeof e !== 'undefined')
                    return e;

                // then check if there is a matching method in the wrapped object
                if (target._methods.includes(name))
                {
                    return this._getFunctionInvocation(target, name);
                }

                // then check for a matching property or field
                let property = target._properties[name];
                if (property)
                {
                    return IA.__internal.wrapNetObjectResult(target._netWrapper.invokeMethod("GetProperty", name));
                }

                let event = target._events[name]
                if (event)
                {
                    // return function which binds a listener function
                    return listener => target._addEventListener(name, listener);
                }
                
                if (target._supportsIndexRead)
                {
                    return this._getFunctionInvocation(target, "get_Item")(name);
                }

                return undefined;
            },
            set(target, name, value)
            {
                let property = target._properties[name];
                if (property)
                {
                    target._netWrapper.invokeMethod("SetProperty", name, value);
                    return true;
                }

                let event = target._events[name];
                if (event)
                {
                    target._addEventListener(name, value);
                    return true;
                }

                target[name] = value;
                return true;
            },
            _getFunctionInvocation(target, name)
            {
                return function(...args) {
                    IA.__internal.argumentsToDotNet(args);
                    let result = target._netWrapper.invokeMethod("InvokeMethod", name, args);
                    return IA.__internal.wrapNetObjectResult(result);
                }
            }
        });
    }

    // Returns callback to remove the listener
    _addEventListener(eventName, listener)
    {
        let listenerId = this._netWrapper.invokeMethod("AddEventListener", eventName)
        IA.__internal.eventCallbacks[listenerId] = listener;
        return () => {
            delete IA.__internal.eventCallbacks[listenerId];
            // this._netWrapper.invokeMethod("RemoveEventListener", listenerId);
            console.log("IA Runtime removing event listener " + listenerId);
            DotNet.invokeMethod("IARuntime_BlazorJS", "RemoveEventListener", listenerId);
        }
    }
}

