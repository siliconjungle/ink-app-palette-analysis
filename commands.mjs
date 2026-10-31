import {commandBridge} from './.ink-commands/command-bridge.js';
const actions={
  "analyse-file": [
    {
      "action": "analyse"
    }
  ],
  "analyse": [
    {
      "click": "#open"
    }
  ],
  "settings": [
    {
      "click": "#settings"
    }
  ]
};
const wait=async selector=>{for(let i=0;i<200;i++){const element=document.querySelector(selector);if(element&&!element.disabled)return element;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('This app control is not ready: '+selector);};
async function perform(steps,input){for(const step of steps){if(step.action){for(let i=0;i<200&&!globalThis.InkAppCommandHandlers?.[step.action];i++)await new Promise(resolve=>setTimeout(resolve,100));if(!globalThis.InkAppCommandHandlers?.[step.action])throw Error('App action unavailable');await globalThis.InkAppCommandHandlers[step.action](input);continue;}if(step.fill&&input[step.input]===undefined)continue;const element=await wait(step.click||step.fill||step.submit||step.focus);if(step.click)element.click();else if(step.fill){const descriptor=Object.getOwnPropertyDescriptor(element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');descriptor.set.call(element,String(input[step.input]));element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));}else if(step.submit)element.requestSubmit();else element.focus();}}
export const commands=commandBridge({origin:new URLSearchParams(location.search).get('desktopOrigin')||location.origin,handlers:Object.fromEntries(Object.entries(actions).map(([id,steps])=>[id,input=>perform(steps,input)]))});
